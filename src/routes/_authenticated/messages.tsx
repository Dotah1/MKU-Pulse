import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import { ArrowLeft, GraduationCap, Loader2, Reply, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SafetyMenu } from "@/components/SafetyMenu";
import { isBlockedWith } from "@/lib/blocks";
import { notify } from "@/lib/notify";
import { useCampus } from "@/hooks/useCampus";
import { StoredImage, UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { sanitizeText, timeAgo } from "@/lib/campus";
import { fetchProfiles, getOrCreateConversation, type MiniProfile } from "@/lib/campus-data";

export const Route = createFileRoute("/_authenticated/messages")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search["c"] === "string" ? (search["c"] as string) : undefined,
    p: typeof search["p"] === "string" ? (search["p"] as string) : undefined,
    notification_event:
      typeof search["notification_event"] === "string" &&
      /^[0-9a-f-]{36}$/i.test(search["notification_event"])
        ? search["notification_event"]
        : undefined,
    notification_kind:
      typeof search["notification_kind"] === "string" ? search["notification_kind"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Messages — MKU Pulse" },
      {
        name: "description",
        content: "Your unified campus inbox with real-time chat and typing indicators.",
      },
      { property: "og:title", content: "Messages — MKU Pulse" },
      { property: "og:description", content: "Real-time chat with matches and mentors." },
    ],
  }),
  component: MessagesPage,
});

interface ConversationRow {
  id: string;
  user_a: string;
  user_b: string;
  last_message: string;
  last_message_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  reply_to_id: string | null;
  post_id: string | null;
  read_at: string | null;
  created_at: string;
}

const MESSAGE_PAGE_SIZE = 50;

interface PostRef {
  id: string;
  content: string;
  image_url: string | null;
}

/** Small preview of the post a message is about. */
function PostRefCard({
  post,
  tone,
  label = "About this post",
}: {
  post: PostRef;
  tone: "mine" | "theirs" | "composer";
  label?: string;
}) {
  return (
    <Link
      to="/p/$id"
      params={{ id: post.id }}
      className={`mb-1 flex items-center gap-2 rounded-lg border-l-4 px-2 py-1.5 text-xs ${
        tone === "mine"
          ? "border-primary-foreground/70 bg-primary-foreground/15 text-primary-foreground"
          : "border-primary bg-primary/10 text-foreground"
      }`}
    >
      {post.image_url && (
        <StoredImage
          path={post.image_url}
          alt="Post picture"
          className="size-9 shrink-0 rounded-md object-cover"
        />
      )}
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        <span className="block truncate opacity-80">{post.content || "Photo or video post"}</span>
      </span>
    </Link>
  );
}

function MessagesPage() {
  const { user } = useCampus();
  const {
    c,
    p,
    notification_event: notificationEvent,
    notification_kind: notificationKind,
  } = Route.useSearch();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [people, setPeople] = useState<Record<string, MiniProfile>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mentorConversationIds, setMentorConversationIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const loadedContext = useRef<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select("id, user_a, user_b, last_message, last_message_at")
      .order("last_message_at", { ascending: false });
    const rows = (data ?? []) as ConversationRow[];
    setConversations(rows);
    const otherIds = rows.map((r) => (r.user_a === user.id ? r.user_b : r.user_a));
    const [profiles, mentorResult, unreadResult] = await Promise.all([
      fetchProfiles(otherIds),
      otherIds.length > 0
        ? supabase.from("mentors").select("user_id").in("user_id", otherIds)
        : Promise.resolve({ data: [] as { user_id: string }[] }),
      rows.length > 0
        ? supabase.from("messages").select("conversation_id").in("conversation_id", rows.map((row) => row.id)).neq("sender_id", user.id).is("read_at", null)
        : Promise.resolve({ data: [] as { conversation_id: string }[] }),
    ]);
    const counts: Record<string, number> = {};
    for (const row of (unreadResult.data ?? []) as { conversation_id: string }[]) {
      counts[row.conversation_id] = (counts[row.conversation_id] ?? 0) + 1;
    }
    setUnreadCounts(counts);
    const mentorIds = new Set<string>();
    for (const mentor of (mentorResult.data ?? []) as { user_id: string }[]) {
      const conversation = rows.find((row) => (row.user_a === user.id ? row.user_b : row.user_a) === mentor.user_id);
      if (conversation) mentorIds.add(conversation.id);
    }
    setMentorConversationIds(mentorIds);
    setPeople(profiles);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    const context = `${user?.id ?? "no-user"}:${c ?? "inbox"}`;
    if (loadedContext.current === context) return;
    loadedContext.current = context;
    if (!c || !conversations.some((conversation) => conversation.id === c)) void load();
  }, [c, conversations, load, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    if (c) setUnreadCounts((current) => ({ ...current, [c]: 0 }));
  }, [c, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`inbox-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new as { conversation_id?: string; sender_id?: string };
        if (!row.conversation_id || row.sender_id === user.id) return;
        setUnreadCounts((current) => ({
          ...current,
          [row.conversation_id as string]: (current[row.conversation_id as string] ?? 0) + 1,
        }));
      })
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as {
            conversation_id?: string;
            sender_id?: string;
            read_at?: string | null;
          };
          if (!row.conversation_id || row.sender_id === user.id || !row.read_at) return;
          const conversationId = row.conversation_id;
          setUnreadCounts((current) => {
            const next = { ...current };
            if (c === conversationId) {
              next[conversationId] = 0;
            } else {
              next[conversationId] = Math.max(0, (next[conversationId] ?? 0) - 1);
            }
            return next;
          });
        },
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [user?.id, c]);

  useEffect(() => {
    if (!user || !p || c) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, user_id")
        .eq("id", p)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        toast.error("That post is unavailable");
        return;
      }
      if (data.user_id === user.id) {
        toast.error("You can't start a conversation with yourself");
        return;
      }
      try {
        const conversationId = await getOrCreateConversation(user.id, data.user_id);
        if (active)
          void navigate({
            to: "/messages",
            search: {
              c: conversationId,
              p,
              notification_event: undefined,
              notification_kind: undefined,
            },
          });
      } catch {
        toast.error("Could not open a conversation about that post");
      }
    })();
    return () => {
      active = false;
    };
  }, [user, p, c, navigate]);

  const active = conversations.find((x) => x.id === c);
  const focusMessageId =
    notificationEvent && (!notificationKind || notificationKind === "message")
      ? notificationEvent
      : undefined;
  const dismissPost = useCallback(() => {
    void navigate({
      to: "/messages",
      search: {
        c: active?.id ?? c,
        p: undefined,
        notification_event: undefined,
        notification_kind: undefined,
      },
    });
  }, [navigate, active?.id, c]);

  if (c && active) {
    const otherId = active.user_a === user?.id ? active.user_b : active.user_a;
    return (
      <ChatPane
        conversation={active}
        other={people[otherId]}
        postId={p}
        focusMessageId={focusMessageId}
        onDismissPost={dismissPost}
        onBack={() =>
          void navigate({
            to: "/messages",
            search: {
              c: undefined,
              p: undefined,
              notification_event: undefined,
              notification_kind: undefined,
            },
          })
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Messages</h1>
      {loading ? (
        <Loader2 className="mx-auto my-12 size-6 animate-spin text-muted-foreground" />
      ) : conversations.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No conversations yet. Message someone from the feed, your matches or a mentor.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {conversations.map((conv) => {
            const otherId = conv.user_a === user?.id ? conv.user_b : conv.user_a;
            const p = people[otherId];
            const unread = unreadCounts[conv.id] ?? 0;
            const isMentorConversation = mentorConversationIds.has(conv.id);
            return (
              <li key={conv.id} className={`flex items-center gap-3 border-l-4 px-4 hover:bg-secondary ${isMentorConversation ? "border-primary bg-primary/5" : unread > 0 ? "border-accent bg-accent/5" : "border-transparent"}`}>
                <Link
                  to="/u/$id"
                  params={{ id: otherId }}
                  aria-label={`View ${p?.full_name ?? "student"}'s profile`}
                  className="shrink-0 py-3"
                >
                  <UserAvatar
                    path={p?.avatar_url}
                    name={p?.full_name ?? "Student"}
                    className="size-11"
                  />
                </Link>
                <button
                  onClick={() =>
                    void navigate({
                      to: "/messages",
                      search: {
                        c: conv.id,
                        p: undefined,
                        notification_event: undefined,
                        notification_kind: undefined,
                      },
                    })
                  }
                  className="flex flex-1 items-center gap-3 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{p?.full_name ?? "Student"}</p>
                      {isMentorConversation && <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]"><GraduationCap className="size-3" aria-hidden="true" /> Mentor</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {conv.last_message || "Say hello"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground">{timeAgo(conv.last_message_at)}</span>
                    {unread > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">{unread > 99 ? "99+" : unread} unread</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChatPane({
  conversation,
  other,
  postId,
  focusMessageId,
  onDismissPost,
  onBack,
}: {
  conversation: ConversationRow;
  other: MiniProfile | undefined;
  postId: string | undefined;
  focusMessageId: string | undefined;
  onDismissPost: () => void;
  onBack: () => void;
}) {
  const { user, limits } = useCampus();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [postDraft, setPostDraft] = useState<PostRef | null>(null);
  const [linkedPosts, setLinkedPosts] = useState<Record<string, PostRef>>({});
  const [sending, setSending] = useState(false);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messageElements = useRef(new Map<string, HTMLDivElement>());
  const focusedMessage = useRef<MessageRow | null>(null);
  const loadGeneration = useRef(0);
  const olderLoadGeneration = useRef(0);
  const activeMessageLoad = useRef<number | null>(null);
  const pendingMessageChanges = useRef(new Map<string, Partial<MessageRow> | null>());
  const messageList = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  const currentUserId = user?.id;
  const otherId = useMemo(
    () => (conversation.user_a === user?.id ? conversation.user_b : conversation.user_a),
    [conversation, user?.id],
  );
  const [chatBlocked, setChatBlocked] = useState(false);
  useEffect(() => {
    if (!currentUserId) return;
    void isBlockedWith(currentUserId, otherId).then(setChatBlocked);
  }, [currentUserId, otherId]);

  const markConversationRead = useCallback(async () => {
    if (!currentUserId) return;
    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", conversation.id)
      .neq("sender_id", currentUserId)
      .is("read_at", null);
  }, [conversation.id, currentUserId]);

  const load = useCallback(async () => {
    olderLoadGeneration.current += 1;
    setLoadingOlderMessages(false);
    const generation = ++loadGeneration.current;
    activeMessageLoad.current = generation;
    pendingMessageChanges.current.clear();
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, reply_to_id, post_id, read_at, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE + 1);
    if (generation !== loadGeneration.current) return;
    const page = (data ?? []) as MessageRow[];
    const rowsById = new Map(
      page
        .slice(0, MESSAGE_PAGE_SIZE)
        .reverse()
        .map((message) => [message.id, message]),
    );
    const pinnedMessage = focusedMessage.current;
    if (pinnedMessage?.conversation_id === conversation.id) {
      rowsById.set(pinnedMessage.id, pinnedMessage);
    }
    for (const [id, change] of pendingMessageChanges.current) {
      if (change === null) {
        rowsById.delete(id);
      } else {
        const existing = rowsById.get(id);
        if (existing) {
          rowsById.set(id, { ...existing, ...change });
        } else if (
          change.conversation_id &&
          change.sender_id &&
          change.content !== undefined &&
          change.created_at
        ) {
          rowsById.set(id, change as MessageRow);
        }
      }
    }
    pendingMessageChanges.current.clear();
    activeMessageLoad.current = null;
    const rows = [...rowsById.values()].sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
    );
    setHasOlderMessages(page.length > MESSAGE_PAGE_SIZE);
    setMessages(rows);
    setLoadedConversationId(conversation.id);
    await markConversationRead();
    const postIds = [
      ...new Set(rows.map((message) => message.post_id).filter(Boolean)),
    ] as string[];
    if (postIds.length === 0) return;
    const { data: posts } = await supabase
      .from("posts")
      .select("id, content, image_url")
      .in("id", postIds);
    if (generation !== loadGeneration.current) return;
    const map: Record<string, PostRef> = {};
    for (const post of (posts ?? []) as PostRef[]) map[post.id] = post;
    setLinkedPosts((current) => ({ ...current, ...map }));
  }, [conversation.id, markConversationRead]);

  const loadPostRef = useCallback(async (postId: string) => {
    const { data } = await supabase
      .from("posts")
      .select("id, content, image_url")
      .eq("id", postId)
      .maybeSingle();
    if (data) {
      setLinkedPosts((current) => ({ ...current, [postId]: data as PostRef }));
    }
  }, []);

  useEffect(() => {
    focusedMessage.current = null;
    setHighlightedMessageId(null);
    if (!focusMessageId) return;

    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, conversation_id, sender_id, content, reply_to_id, post_id, read_at, created_at",
        )
        .eq("id", focusMessageId)
        .eq("conversation_id", conversation.id)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        toast.error("That message is no longer available");
        return;
      }

      const message = data as MessageRow;
      focusedMessage.current = message;
      setMessages((current) => {
        if (current.some((item) => item.id === message.id)) return current;
        return [...current, message].sort(
          (left, right) =>
            left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
        );
      });
      setHighlightedMessageId(message.id);
      if (message.post_id) void loadPostRef(message.post_id);
    })();

    return () => {
      active = false;
    };
  }, [focusMessageId, conversation.id, loadPostRef]);

  const appendMessage = useCallback((message: MessageRow) => {
    if (activeMessageLoad.current !== null) {
      pendingMessageChanges.current.set(message.id, message);
    }
    setMessages((current) => {
      if (current.some((item) => item.id === message.id)) {
        return current.map((item) =>
          item.id === message.id
            ? { ...item, ...message, read_at: message.read_at ?? item.read_at }
            : item,
        );
      }
      return [...current, message].sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
      );
    });
  }, []);

  const loadOlderMessages = async () => {
    const oldest = messages[0];
    if (!oldest || loadingOlderMessages || !hasOlderMessages) return;
    const generation = ++olderLoadGeneration.current;
    setLoadingOlderMessages(true);
    const cursor = oldest.created_at;
    const { data, error } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, reply_to_id, post_id, read_at, created_at")
      .eq("conversation_id", conversation.id)
      .or(`created_at.lt.${cursor},and(created_at.eq.${cursor},id.lt.${oldest.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE + 1);
    if (generation !== olderLoadGeneration.current) return;
    setLoadingOlderMessages(false);
    if (error) {
      toast.error("Could not load earlier messages");
      return;
    }

    const page = (data ?? []) as MessageRow[];
    setHasOlderMessages(page.length > MESSAGE_PAGE_SIZE);
    const older = page.slice(0, MESSAGE_PAGE_SIZE).reverse();
    if (older.length === 0) return;
    const container = messageList.current;
    const anchor = container ? { height: container.scrollHeight, top: container.scrollTop } : null;
    if (container) {
      scrollAnchor.current = anchor;
    }
    setMessages((current) => {
      const existingIds = new Set(current.map((message) => message.id));
      return [...older.filter((message) => !existingIds.has(message.id)), ...current];
    });
    if (anchor) {
      window.requestAnimationFrame(() => {
        if (scrollAnchor.current === anchor) scrollAnchor.current = null;
      });
    }

    const postIds = [
      ...new Set(older.map((message) => message.post_id).filter(Boolean)),
    ] as string[];
    if (postIds.length > 0) {
      const { data: posts } = await supabase
        .from("posts")
        .select("id, content, image_url")
        .in("id", postIds);
      if (generation !== olderLoadGeneration.current) return;
      const map: Record<string, PostRef> = {};
      for (const post of (posts ?? []) as PostRef[]) map[post.id] = post;
      setLinkedPosts((current) => ({ ...current, ...map }));
    }
  };

  useEffect(() => {
    if (!postId) {
      setPostDraft(null);
      return;
    }
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("id, content, image_url")
        .eq("id", postId)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setPostDraft(null);
        toast.error("That post is unavailable");
        onDismissPost();
        return;
      }
      setPostDraft(data as PostRef);
    })();
    return () => {
      active = false;
    };
  }, [postId, onDismissPost]);

  const latestMessageId = messages[messages.length - 1]?.id;
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    const container = messageList.current;
    if (!anchor || !container) return;
    container.scrollTop = anchor.top + (container.scrollHeight - anchor.height);
    scrollAnchor.current = null;
  }, [messages.length]);

  useEffect(() => {
    if (latestMessageId) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [latestMessageId]);

  useEffect(() => {
    if (!highlightedMessageId || loadedConversationId !== conversation.id) return;
    messageElements.current
      .get(highlightedMessageId)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedMessageId, loadedConversationId, conversation.id]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timeout = window.setTimeout(() => setHighlightedMessageId(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [highlightedMessageId]);

  useEffect(() => {
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let removePending: Promise<unknown> | null = null;
    let disposed = false;
    const isPageHidden = () => document.visibilityState === "hidden";

    const removeActiveChannel = () => {
      const channel = activeChannel;
      if (!channel) return;
      activeChannel = null;
      removePending = supabase
        .removeChannel(channel)
        .catch((error: unknown) => {
          console.warn("Could not pause the background chat channel", error);
        })
        .finally(() => {
          removePending = null;
        });
    };

    const subscribeToActiveChat = async () => {
      if (disposed || isPageHidden() || activeChannel) return;
      if (removePending) await removePending;
      if (disposed || isPageHidden() || activeChannel) return;

      const channel = supabase.channel(`chat-${conversation.id}`);
      activeChannel = channel;
      channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversation.id}`,
          },
          (payload) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as MessageRow;
              if (row.id && row.conversation_id === conversation.id && row.created_at) {
                appendMessage(row);
                if (row.sender_id !== user?.id) markConversationRead();
                if (row.post_id) void loadPostRef(row.post_id);
                return;
              }
            }

            if (payload.eventType === "UPDATE") {
              const row = payload.new as Partial<MessageRow>;
              if (row.id) {
                if (activeMessageLoad.current !== null) {
                  pendingMessageChanges.current.set(row.id, row);
                }
                setMessages((current) =>
                  current.map((message) =>
                    message.id === row.id ? { ...message, ...row } : message,
                  ),
                );
                return;
              }
            }

            if (payload.eventType === "DELETE") {
              const row = payload.old as Partial<MessageRow>;
              if (row.id) {
                if (activeMessageLoad.current !== null) {
                  pendingMessageChanges.current.set(row.id, null);
                }
                setMessages((current) => current.filter((message) => message.id !== row.id));
                return;
              }
            }

            void load();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "typing_state",
            filter: `conversation_id=eq.${conversation.id}`,
          },
          (payload) => {
            const row = payload.new as { user_id?: string; updated_at?: string } | null;
            if (!row?.user_id || row.user_id === user?.id) return;
            setOtherTyping(true);
            window.setTimeout(() => setOtherTyping(false), 3000);
          },
        )
        .subscribe((status) => {
          if (disposed || activeChannel !== channel) return;
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            void load();
          }
        });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        removeActiveChannel();
      } else if (!activeChannel) {
        void subscribeToActiveChat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void subscribeToActiveChat();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      removeActiveChannel();
    };
  }, [conversation.id, user?.id, load, loadPostRef, appendMessage, markConversationRead]);

  const lastTyped = useRef(0);
  const onType = (value: string) => {
    setDraft(value);
    if (!user) return;
    const now = Date.now();
    if (now - lastTyped.current < 1500) return;
    lastTyped.current = now;
    void supabase.from("typing_state").upsert({
      conversation_id: conversation.id,
      user_id: user.id,
      updated_at: new Date().toISOString(),
    });
  };

  const send = async () => {
    const text = sanitizeText(draft, 2000);
    if (!text || !user) return;
    if (!limits.canChatMatches) {
      toast.error("Messaging needs Campus Socialite or Campus VIP");
      return;
    }
    setSending(true);
    const { data: insertedMessage, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        sender_id: user.id,
        content: text,
        reply_to_id: replyTo?.id ?? null,
        post_id: postDraft?.id ?? null,
      })
      .select("id, conversation_id, sender_id, content, reply_to_id, post_id, read_at, created_at")
      .single();
    if (error || !insertedMessage) {
      setSending(false);
      toast.error(error?.message ?? "Could not send message");
      return;
    }
    await supabase
      .from("conversations")
      .update({ last_message: text, last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);
    setDraft("");
    setReplyTo(null);
    if (postDraft) {
      setPostDraft(null);
      onDismissPost();
    }
    setSending(false);
    const sentMessage = insertedMessage as MessageRow;
    appendMessage(sentMessage);
    if (sentMessage.post_id) void loadPostRef(sentMessage.post_id);
    void notify({
      recipientIds: otherId,
      title: "New message",
      body: text.slice(0, 120),
      url: `/messages?c=${conversation.id}`,
      kind: "message",
      eventId: insertedMessage.id,
    });
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={onBack}
          aria-label="Back to inbox"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <Link to="/u/$id" params={{ id: otherId }} aria-label="View profile">
          <UserAvatar
            path={other?.avatar_url}
            name={other?.full_name ?? "Student"}
            className="size-9"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to="/u/$id" params={{ id: otherId }}>
            <p className="text-sm font-semibold hover:underline">{other?.full_name ?? "Student"}</p>
          </Link>
          <p className="text-xs text-muted-foreground">
            {otherTyping ? "typing…" : other?.major || "MKU Pulse"}
          </p>
        </div>
        {currentUserId && (
          <SafetyMenu
            me={currentUserId}
            other={otherId}
            name={other?.full_name ?? undefined}
            onChange={(s) => setChatBlocked(s === "blocked")}
          />
        )}
      </header>

      <div ref={messageList} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {hasOlderMessages && (
          <div className="flex justify-center pb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={loadingOlderMessages}
              onClick={() => void loadOlderMessages()}
            >
              {loadingOlderMessages ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {loadingOlderMessages ? "Loading earlier messages…" : "Load earlier messages"}
            </Button>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          const quoted = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
          const linkedPost = m.post_id ? linkedPosts[m.post_id] : undefined;
          return (
            <div
              key={m.id}
              ref={(element) => {
                if (element) messageElements.current.set(m.id, element);
                else messageElements.current.delete(m.id);
              }}
              className={`group flex items-center gap-1 ${mine ? "justify-end" : "justify-start"}`}
            >
              {mine && (
                <button
                  type="button"
                  onClick={() => setReplyTo(m)}
                  aria-label="Reply to this message"
                  className="text-muted-foreground opacity-60 hover:text-primary"
                >
                  <Reply className="size-4" aria-hidden="true" />
                </button>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  mine
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                } ${highlightedMessageId === m.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
              >
                {quoted && (
                  <p
                    className={`mb-1 truncate border-l-2 pl-2 text-xs ${
                      mine
                        ? "border-primary-foreground/50 text-primary-foreground/80"
                        : "border-primary/50 text-muted-foreground"
                    }`}
                  >
                    {quoted.sender_id === user?.id ? "You" : (other?.full_name ?? "Student")}:{" "}
                    {quoted.content}
                  </p>
                )}
                {linkedPost && (
                  <PostRefCard
                    post={linkedPost}
                    tone={mine ? "mine" : "theirs"}
                    label="Referenced post"
                  />
                )}
                <p className="whitespace-pre-wrap">{m.content}</p>
                <p
                  className={`mt-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                >
                  {timeAgo(m.created_at)}
                  {mine ? (m.read_at ? " · Read" : " · Sent") : ""}
                </p>
              </div>
              {!mine && (
                <button
                  type="button"
                  onClick={() => setReplyTo(m)}
                  aria-label="Reply to this message"
                  className="text-muted-foreground opacity-60 hover:text-primary"
                >
                  <Reply className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
        {otherTyping && <p className="text-xs text-muted-foreground">typing…</p>}
        <div ref={bottom} />
      </div>

      {replyTo && (
        <div className="flex items-center gap-2 border-t border-border bg-secondary/60 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 truncate">
            Replying to{" "}
            {replyTo.sender_id === user?.id ? "yourself" : (other?.full_name ?? "student")}:{" "}
            {replyTo.content}
          </span>
          <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {postDraft && (
        <div className="flex items-start gap-2 border-t border-border bg-secondary/40 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="mb-1 font-semibold text-foreground">Replying to post</p>
            <PostRefCard post={postDraft} tone="composer" label="Tap to open post" />
          </div>
          <button
            type="button"
            onClick={() => {
              setPostDraft(null);
              onDismissPost();
            }}
            aria-label="Dismiss post preview"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {chatBlocked ? (
        <p className="border-t border-border p-4 text-center text-sm text-muted-foreground">
          This conversation is no longer available.
        </p>
      ) : (
      <>
      <div className="border-t border-border px-3 pt-2" aria-label="Campus slang quick replies">
        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Campus quick replies</p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {["Form ni gani?", "Comrades!", "Niko Main Campus", "Library"].map((reply) => (
            <button
              key={reply}
              type="button"
              disabled={sending}
              onClick={() => onType(`${draft}${draft && !/\s$/.test(draft) ? " " : ""}${reply}`)}
              className="min-h-9 shrink-0 rounded-full border border-border bg-background px-3 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {reply}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <Textarea
          value={draft}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={`Message ${other?.full_name?.split(" ")[0] ?? "student"}…`}
          aria-label="Message"
          className="min-h-11 resize-none"
        />
        <Button
          onClick={() => void send()}
          disabled={sending}
          className="min-h-11"
          aria-label="Send"
        >
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </div>
      </>
      )}
    </div>
  );
}
