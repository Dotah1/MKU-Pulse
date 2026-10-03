import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_EMAIL } from "@/lib/campus";
import { createAnnouncementUrl } from "@/lib/announcement";

export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
  configured: boolean;
}

/** Publishable Firebase web config (safe for the browser), sourced from project secrets. */
export const getFirebaseWebConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<FirebaseWebConfig> => {
    const apiKey = process.env["FIREBASE_API_KEY"] ?? "";
    const projectId = process.env["FIREBASE_PROJECT_ID"] ?? "";
    const messagingSenderId = process.env["FIREBASE_MESSAGING_SENDER_ID"] ?? "";
    const appId = process.env["FIREBASE_APP_ID"] ?? "";
    const vapidKey = process.env["FIREBASE_VAPID_KEY"] ?? "";
    return {
      apiKey,
      projectId,
      messagingSenderId,
      appId,
      vapidKey,
      configured: Boolean(apiKey && projectId && messagingSenderId && appId && vapidKey),
    };
  },
);

/** Saves (or refreshes) the caller's FCM device token. */
export const registerDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string; platform?: string; expectedUserId: string }) => {
    const token = String(input?.token ?? "").trim();
    if (token.length < 20 || token.length > 4096) throw new Error("Invalid device token");
    const platform = input?.platform === "android" ? "android" : "web";
    const expectedUserId = String(input?.expectedUserId ?? "").trim();
    if (!expectedUserId) throw new Error("Expected account is required for push registration");
    return { token, platform, expectedUserId };
  })
  .handler(async ({ data, context }) => {
    if (data.expectedUserId !== context.userId) {
      throw new Error("Signed-in account changed; push registration was cancelled");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // A token belongs to one device: re-registering moves it to the current user.
    const { error } = await supabaseAdmin.from("device_tokens").upsert(
      {
        user_id: context.userId,
        token: data.token,
        platform: data.platform,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Removes a device token (sign-out or notifications turned off). */
export const unregisterDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string; expectedUserId: string }) => {
    const token = String(input?.token ?? "").trim();
    const expectedUserId = String(input?.expectedUserId ?? "").trim();
    if (!expectedUserId) throw new Error("Expected account is required for push cleanup");
    return { token, expectedUserId };
  })
  .handler(async ({ data, context }) => {
    if (!data.token) return { ok: true };
    if (data.expectedUserId !== context.userId) {
      throw new Error("Signed-in account changed; push token cleanup was not confirmed");
    }
    const { error } = await context.supabase
      .from("device_tokens")
      .delete()
      .eq("token", data.token)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const clean = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .slice(0, max)
    .trim();

const notificationKinds = new Set([
  "message",
  "match",
  "mentorship",
  "payment",
  "moderation",
  "post-like",
  "post-comment",
  "poll-vote",
  "compliment",
]);

const withEventKey = (url: string, eventId?: string) => {
  if (!eventId) return url;
  const target = new URL(url, "https://mku-pulse.invalid");
  target.searchParams.set("notification_event", eventId);
  return `${target.pathname}${target.search}${target.hash}`;
};

const isRecentEvent = (timestamp: string | null | undefined) => {
  const createdAt = Date.parse(timestamp ?? "");
  const now = Date.now();
  return Number.isFinite(createdAt) && createdAt <= now + 60_000 && createdAt >= now - 10 * 60_000;
};

/**
 * Stores an in-app notification and sends its push after verifying the actual
 * persisted interaction and recipient. Admin-only event types require the
 * configured admin identity. Event IDs in the in-app URL make retries idempotent.
 */
export const notifyUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      recipientIds: string[] | string;
      title: string;
      body?: string;
      url?: string;
      kind?: string;
      eventId?: string;
    }) => {
      const ids = (Array.isArray(input?.recipientIds) ? input.recipientIds : [input?.recipientIds])
        .map((id) => String(id ?? "").trim())
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const title = clean(input?.title, 80);
      if (ids.length === 0) throw new Error("No recipients");
      if (!title) throw new Error("A title is required");
      const kind = clean(input?.kind, 40) || "general";
      if (!notificationKinds.has(kind)) throw new Error("Unsupported notification kind");
      const recipientIds = [...new Set(ids)];
      if (recipientIds.length > (kind === "post-comment" ? 2 : 1)) {
        throw new Error("Too many recipients for this event");
      }
      const eventId = String(input?.eventId ?? "").trim() || undefined;
      if (eventId && !/^[0-9a-f-]{36}$/i.test(eventId)) throw new Error("Invalid event ID");
      const rawUrl = clean(input?.url, 200);
      let url = "/notifications";
      if (rawUrl.startsWith("/")) {
        try {
          const target = new URL(rawUrl, "https://mku-pulse.invalid");
          if (target.origin === "https://mku-pulse.invalid") {
            url = `${target.pathname}${target.search}${target.hash}`;
          }
        } catch {
          // Fall back to the in-app notification center for malformed URLs.
        }
      }
      return {
        recipientIds,
        title,
        body: clean(input?.body, 300),
        url,
        kind,
        eventId,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const recipients = data.recipientIds.filter((id) => id !== context.userId);
    if (recipients.length === 0) return { sent: 0 };
    if (recipients.length > (data.kind === "post-comment" ? 2 : 1)) {
      throw new Error("Too many recipients for this event");
    }

    const isAdmin =
      String(context.claims["email"] ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const recipientId = recipients[0];
    if (!recipientId) return { sent: 0 };
    const target = new URL(data.url, "https://mku-pulse.invalid");
    const eventId = data.eventId;
    let eventOccurredAt: string | null = null;
    const requireEventId = () => {
      if (!eventId) throw new Error("A persisted event ID is required");
      return eventId;
    };
    const denied = () => new Error("Notification is not authorized for this event");

    switch (data.kind) {
      case "message": {
        const id = requireEventId();
        if (recipients.length !== 1 || target.pathname !== "/messages") throw denied();
        const { data: message, error } = await supabaseAdmin
          .from("messages")
          .select("conversation_id, sender_id, created_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (
          !message ||
          message.sender_id !== context.userId ||
          !isRecentEvent(message.created_at)
        ) {
          throw denied();
        }
        eventOccurredAt = message.created_at;
        const { data: conversation, error: conversationError } = await supabaseAdmin
          .from("conversations")
          .select("user_a, user_b")
          .eq("id", message.conversation_id)
          .maybeSingle();
        if (conversationError) throw new Error(conversationError.message);
        const isPair =
          conversation?.user_a === context.userId && conversation.user_b === recipientId;
        const isReversedPair =
          conversation?.user_b === context.userId && conversation.user_a === recipientId;
        if (
          (!isPair && !isReversedPair) ||
          target.searchParams.get("c") !== message.conversation_id
        ) {
          throw denied();
        }
        break;
      }
      case "match": {
        const id = requireEventId();
        if (recipients.length !== 1 || target.pathname !== "/connect") throw denied();
        const { data: match, error } = await supabaseAdmin
          .from("matches")
          .select("user_a, user_b, is_active, created_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const isPair =
          (match?.user_a === context.userId && match.user_b === recipientId) ||
          (match?.user_b === context.userId && match.user_a === recipientId);
        if (!match?.is_active || !isPair || !isRecentEvent(match.created_at)) throw denied();
        eventOccurredAt = match.created_at;
        break;
      }
      case "mentorship": {
        const id = requireEventId();
        if (recipients.length !== 1) throw denied();
        if (isAdmin) {
          const { data: application, error } = await supabaseAdmin
            .from("mentor_applications")
            .select("user_id, reviewed_by, status, reviewed_at")
            .eq("id", id)
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (
            target.pathname !== "/mentorship" ||
            !application ||
            application.user_id !== recipientId ||
            application.reviewed_by !== context.userId ||
            !["approved", "rejected"].includes(application.status) ||
            !isRecentEvent(application.reviewed_at)
          ) {
            throw denied();
          }
          eventOccurredAt = application.reviewed_at;
        } else {
          const { data: session, error } = await supabaseAdmin
            .from("mentor_sessions")
            .select("mentor_id, student_id, status, created_at")
            .eq("id", id)
            .maybeSingle();
          if (error) throw new Error(error.message);
          const requestToMentor =
            session?.student_id === context.userId &&
            session.mentor_id === recipientId &&
            session.status === "pending" &&
            target.pathname === "/mentorship";
          const mentorApproval =
            session?.mentor_id === context.userId &&
            session.student_id === recipientId &&
            session.status === "approved" &&
            target.pathname === "/messages";
          if (
            (!requestToMentor && !mentorApproval) ||
            (requestToMentor && !isRecentEvent(session?.created_at))
          ) {
            throw denied();
          }
          eventOccurredAt = session?.created_at ?? null;
        }
        break;
      }
      case "payment": {
        const id = requireEventId();
        if (!isAdmin || recipients.length !== 1 || target.pathname !== "/profile") throw denied();
        const { data: payment, error } = await supabaseAdmin
          .from("payment_requests")
          .select("user_id, reviewed_by, status, reviewed_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (
          !payment ||
          payment.user_id !== recipientId ||
          payment.reviewed_by !== context.userId ||
          !["approved", "rejected"].includes(payment.status) ||
          !isRecentEvent(payment.reviewed_at)
        ) {
          throw denied();
        }
        eventOccurredAt = payment.reviewed_at;
        break;
      }
      case "moderation": {
        if (!isAdmin || recipients.length !== 1 || target.pathname !== "/feed") throw denied();
        const { data: profile, error } = await supabaseAdmin
          .from("profiles")
          .select("post_block_until")
          .eq("id", recipientId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const blockUntil = Date.parse(profile?.post_block_until ?? "");
        if (!Number.isFinite(blockUntil) || blockUntil <= Date.now()) throw denied();
        break;
      }
      case "post-like": {
        const id = requireEventId();
        if (recipients.length !== 1) throw denied();
        const { data: like, error } = await supabaseAdmin
          .from("post_likes")
          .select("post_id, user_id, created_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const { data: post, error: postError } = like
          ? await supabaseAdmin.from("posts").select("user_id").eq("id", like.post_id).maybeSingle()
          : { data: null, error: null };
        if (postError) throw new Error(postError.message);
        if (
          !like ||
          like.user_id !== context.userId ||
          !isRecentEvent(like.created_at) ||
          !post ||
          post.user_id !== recipientId ||
          target.pathname !== `/p/${like.post_id}`
        ) {
          throw denied();
        }
        eventOccurredAt = like.created_at;
        break;
      }
      case "post-comment": {
        const id = requireEventId();
        if (recipients.length > 2) throw denied();
        const { data: comment, error } = await supabaseAdmin
          .from("post_comments")
          .select("post_id, user_id, created_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const { data: post, error: postError } = comment
          ? await supabaseAdmin
              .from("posts")
              .select("user_id")
              .eq("id", comment.post_id)
              .maybeSingle()
          : { data: null, error: null };
        if (postError) throw new Error(postError.message);
        if (
          !comment ||
          comment.user_id !== context.userId ||
          !isRecentEvent(comment.created_at) ||
          !post
        ) {
          throw denied();
        }
        if (target.pathname !== `/p/${comment.post_id}`) throw denied();
        eventOccurredAt = comment.created_at;
        for (const id of recipients) {
          if (id === post.user_id) continue;
          const { data: participant, error: participantError } = await supabaseAdmin
            .from("post_comments")
            .select("id")
            .eq("post_id", comment.post_id)
            .eq("user_id", id)
            .limit(1)
            .maybeSingle();
          if (participantError) throw new Error(participantError.message);
          if (!participant) throw denied();
        }
        break;
      }
      case "poll-vote": {
        const id = requireEventId();
        if (recipients.length !== 1) throw denied();
        const { data: vote, error } = await supabaseAdmin
          .from("poll_votes")
          .select("poll_id, user_id, created_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const { data: poll, error: pollError } = vote
          ? await supabaseAdmin
              .from("polls")
              .select("created_by")
              .eq("id", vote.poll_id)
              .maybeSingle()
          : { data: null, error: null };
        if (pollError) throw new Error(pollError.message);
        if (
          !vote ||
          vote.user_id !== context.userId ||
          !isRecentEvent(vote.created_at) ||
          !poll ||
          poll.created_by !== recipientId ||
          target.pathname !== "/feed" ||
          target.hash !== `#poll-${vote.poll_id}`
        ) {
          throw denied();
        }
        eventOccurredAt = vote.created_at;
        break;
      }
      case "compliment": {
        const id = requireEventId();
        if (recipients.length !== 1 || !["/profile", "/messages"].includes(target.pathname)) {
          throw denied();
        }
        const { data: compliment, error } = await supabaseAdmin
          .from("campus_crushes")
          .select("sender_id, recipient_id, created_at")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (
          !compliment ||
          compliment.sender_id !== context.userId ||
          compliment.recipient_id !== recipientId ||
          !isRecentEvent(compliment.created_at)
        ) {
          throw denied();
        }
        eventOccurredAt = compliment.created_at;
        break;
      }
      default:
        throw denied();
    }

    // Reuse source event IDs when available; otherwise give this alert one
    // stable key shared by its in-app row, FCM payload, and foreground feedback.
    const notificationEventId = data.eventId ?? crypto.randomUUID();
    const notificationUrl = withEventKey(data.url, notificationEventId);
    const recipientsToInsert: string[] = [];
    for (const id of recipients) {
      if (data.eventId) {
        const { data: existing, error } = await supabaseAdmin
          .from("notifications")
          .select("id")
          .eq("user_id", id)
          .eq("kind", data.kind)
          .eq("url", notificationUrl)
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (existing) continue;
        if (eventOccurredAt) {
          const { data: legacy, error: legacyError } = await supabaseAdmin
            .from("notifications")
            .select("id")
            .eq("user_id", id)
            .eq("kind", data.kind)
            .eq("url", data.url)
            .gte("created_at", eventOccurredAt)
            .limit(1)
            .maybeSingle();
          if (legacyError) throw new Error(legacyError.message);
          if (legacy) continue;
        }
      }
      recipientsToInsert.push(id);
    }
    if (recipientsToInsert.length === 0) return { sent: 0 };

    const { error: insertError } = await supabaseAdmin.from("notifications").insert(
      recipientsToInsert.map((id) => ({
        user_id: id,
        kind: data.kind,
        title: data.title,
        body: data.body,
        url: notificationUrl,
      })),
    );
    if (insertError) throw new Error(insertError.message);

    // Respect each recipient's notification preference for push only.
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, notifications_enabled")
      .in("id", recipientsToInsert);
    const pushable = (profiles ?? [])
      .filter((p) => p.notifications_enabled !== false)
      .map((p) => p.id);
    if (pushable.length === 0) return { sent: 0 };

    const { data: tokenRows } = await supabaseAdmin
      .from("device_tokens")
      .select("token")
      .in("user_id", pushable);
    const tokens = (tokenRows ?? []).map((row) => row.token);
    if (tokens.length === 0) return { sent: 0 };

    try {
      const { sendFcmToTokens } = await import("./fcm.server");
      const { sent, staleTokens } = await sendFcmToTokens(tokens, {
        title: data.title,
        body: data.body,
        url: notificationUrl,
        kind: data.kind,
      });
      if (staleTokens.length > 0) {
        await supabaseAdmin.from("device_tokens").delete().in("token", staleTokens);
      }
      return { sent };
    } catch (error) {
      // The in-app notification is already saved; never fail the user's action.
      console.error("Push delivery failed", error);
      return { sent: 0 };
    }
  });

/** Creates next-open announcement records and sends expiry-bounded push to consented devices. */
export const broadcastAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { title: string; body: string; imagePath?: string | null; durationHours?: number }) => {
      const title = clean(input?.title, 80);
      const body = clean(input?.body, 1000);
      const imagePath = clean(input?.imagePath, 512) || null;
      const durationHours = Number(input?.durationHours ?? 24);
      if (!title) throw new Error("An announcement title is required");
      if (!body) throw new Error("An announcement message is required");
      if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 168) {
        throw new Error("Announcement duration must be between 1 and 168 hours");
      }
      return { title, body, imagePath, durationHours };
    },
  )
  .handler(async ({ data, context }) => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== ADMIN_EMAIL.toLowerCase()) throw new Error("Forbidden: admin access required");
    if (data.imagePath && !data.imagePath.startsWith(`${context.userId}/`)) {
      throw new Error("Announcement image must be uploaded to your own media folder");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const expiresAt = Date.now() + data.durationHours * 3_600_000;
    const announcementUrl = withEventKey(
      createAnnouncementUrl(data.imagePath, expiresAt),
      crypto.randomUUID(),
    );
    const recipientIds: string[] = [];
    const pushRecipientIds = new Set<string>();
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("id, notifications_enabled")
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      const page = profiles ?? [];
      for (const profile of page) {
        if (profile.id === context.userId) continue;
        recipientIds.push(profile.id);
        if (profile.notifications_enabled !== false) pushRecipientIds.add(profile.id);
      }
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    const recipients = [...new Set(recipientIds)];
    for (let start = 0; start < recipients.length; start += 500) {
      const rows = recipients.slice(start, start + 500).map((user_id) => ({
        user_id,
        kind: "announcement",
        title: data.title,
        body: data.body,
        url: announcementUrl,
      }));
      const { error } = await supabaseAdmin.from("notifications").insert(rows);
      if (error) throw new Error(error.message);
    }

    let sent = 0;
    try {
      const { sendFcmToTokens } = await import("./fcm.server");
      const pushRecipients = [...pushRecipientIds];
      const recipientBatchSize = 500;
      const tokenBatchSize = 100;
      for (let start = 0; start < pushRecipients.length; start += recipientBatchSize) {
        const recipientBatch = pushRecipients.slice(start, start + recipientBatchSize);
        const { data: tokenRows, error: tokenError } = await supabaseAdmin
          .from("device_tokens")
          .select("token")
          .in("user_id", recipientBatch);
        if (tokenError) throw new Error(tokenError.message);
        const tokens = (tokenRows ?? []).map((row) => row.token);
        for (let tokenStart = 0; tokenStart < tokens.length; tokenStart += tokenBatchSize) {
          const tokenBatch = tokens.slice(tokenStart, tokenStart + tokenBatchSize);
          const ttlSeconds = Math.floor((expiresAt - Date.now()) / 1000);
          if (ttlSeconds <= 0) break;
          const result = await sendFcmToTokens(tokenBatch, {
            title: data.title,
            body: data.body,
            url: announcementUrl,
            kind: "announcement",
            ttlSeconds,
          });
          sent += result.sent;
          if (result.staleTokens.length > 0) {
            await supabaseAdmin.from("device_tokens").delete().in("token", result.staleTokens);
          }
        }
      }
    } catch (error) {
      // In-app records already exist; missing Firebase configuration must not
      // prevent an admin announcement from being queued for the next app open.
      console.error("Announcement push delivery failed", error);
    }

    return { recipients: recipients.length, sent };
  });
