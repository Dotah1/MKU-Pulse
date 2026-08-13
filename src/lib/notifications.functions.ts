import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const apiKey = process.env['FIREBASE_API_KEY'] ?? "";
    const projectId = process.env['FIREBASE_PROJECT_ID'] ?? "";
    const messagingSenderId = process.env['FIREBASE_MESSAGING_SENDER_ID'] ?? "";
    const appId = process.env['FIREBASE_APP_ID'] ?? "";
    const vapidKey = process.env['FIREBASE_VAPID_KEY'] ?? "";
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
  .inputValidator((input: { token: string; platform?: string }) => {
    const token = String(input?.token ?? "").trim();
    if (token.length < 20 || token.length > 4096) throw new Error("Invalid device token");
    const platform = input?.platform === "android" ? "android" : "web";
    return { token, platform };
  })
  .handler(async ({ data, context }) => {
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
  .inputValidator((input: { token: string }) => ({ token: String(input?.token ?? "").trim() }))
  .handler(async ({ data, context }) => {
    if (!data.token) return { ok: true };
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

/**
 * Stores an in-app notification for a user and pushes it to their devices.
 * Callable by any signed-in user (message/match/mentorship alerts); content is
 * length-capped and stripped of markup.
 */
export const notifyUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      recipientIds: string[] | string;
      title: string;
      body?: string;
      url?: string;
      kind?: string;
    }) => {
      const ids = (Array.isArray(input?.recipientIds) ? input.recipientIds : [input?.recipientIds])
        .map((id) => String(id ?? "").trim())
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const title = clean(input?.title, 80);
      if (ids.length === 0) throw new Error("No recipients");
      if (ids.length > 500) throw new Error("Too many recipients");
      if (!title) throw new Error("A title is required");
      const rawUrl = clean(input?.url, 200);
      return {
        recipientIds: [...new Set(ids)],
        title,
        body: clean(input?.body, 300),
        url: rawUrl.startsWith("/") ? rawUrl : "/notifications",
        kind: clean(input?.kind, 40) || "general",
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const recipients = data.recipientIds.filter((id) => id !== context.userId);
    if (recipients.length === 0) return { sent: 0 };

    const { error: insertError } = await supabaseAdmin.from("notifications").insert(
      recipients.map((id) => ({
        user_id: id,
        kind: data.kind,
        title: data.title,
        body: data.body,
        url: data.url,
      })),
    );
    if (insertError) throw new Error(insertError.message);

    // Respect each recipient's notification preference for push only.
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, notifications_enabled")
      .in("id", recipients);
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
        url: data.url,
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
