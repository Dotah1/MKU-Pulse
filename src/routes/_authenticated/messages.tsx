import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Reply, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify";
import { useCampus } from "@/hooks/useCampus";
import { StoredImage, UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sanitizeText, timeAgo } from "@/lib/campus";
import { fetchProfiles, getOrCreateConversation, type MiniProfile } from "@/lib/campus-data";

export const Route = createFileRoute("/_authenticated/messages")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search["c"] === "string" ? (search["c"] as string) : undefined,
    p: typeof search["p"] === "string" ? (search["p"] as string) : undefined,
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
  const { c, p } = Route.useSearch();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [people, setPeople] = useState<Record<string, MiniProfile>>({});
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
    setPeople(await fetchProfiles(rows.map((r) => (r.user_a === user.id ? r.user_b : r.user_a))));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    const context = `${user?.id ?? "no-user"}:${c ?? "inbox"}`;
    if (loadedContext.current === context) return;
    loadedContext.current = context;
    if (!c || !conversations.some((conversation) => conversation.id === c)) void load();
  }, [c, conversations, load, user?.id]);

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
        if (active) void navigate({ to: "/messages", search: { c: conversationId, p } });
      } catch {
        toast.error("Could not open a conversation about that post");
      }
    })();
    return () => {
      active = false;
    };
  }, [user, p, c, navigate]);

  const active = conversations.find((x) => x.id === c);
  const dismissPost = useCallback(() => {
    void navigate({ to: "/messages", search: { c: active?.id ?? c, p: undefined } });
  }, [navigate, active?.id, c]);

  if (c && active) {
    const otherId = active.user_a === user?.id ? active.user_b : active.user_a;
    return (
      <ChatPane
        conversation={active}
        other={people[otherId]}
        postId={p}
        onDismissPost={dismissPost}
        onBack={() => void navigate({ to: "/messages", search: { c: undefined, p: undefined } })}
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
            return (
              <li key={conv.id} className="flex items-center gap-3 px-4 hover:bg-secondary">
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
                    void navigate({ to: "/messages", search: { c: conv.id, p: undefined } })
                  }
                  className="flex flex-1 items-center gap-3 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p?.full_name ?? "Student"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {conv.last_message || "Say hello"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(conv.last_message_at)}
                  </span>
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
  onDismissPost,
  onBack,
}: {
  conversation: ConversationRow;
  other: MiniProfile | undefined;
  postId: string | undefined;
  onDismissPost: () => void;
  onBack: () => void;
}) {
  const { user, limits } = useCampus();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [postDraft, setPostDraft] = useState<PostRef | null>(null);
  const [linkedPosts, setLinkedPosts] = useState<Record<string, PostRef>>({});
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const otherId = useMemo(
    () => (conversation.user_a === user?.id ? conversation.user_b : conversation.user_a),
    [conversation, user?.id],
  );

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, reply_to_id, post_id, read_at, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(300);
    const rows = (data ?? []) as MessageRow[];
    setMessages(rows);
    const postIds = [
      ...new Set(rows.map((message) => message.post_id).filter(Boolean)),
    ] as string[];
    if (postIds.length === 0) {
      setLinkedPosts({});
      return;
    }
    const { data: posts } = await supabase
      .from("posts")
      .select("id, content, image_url")
      .in("id", postIds);
    const map: Record<string, PostRef> = {};
    for (const post of (posts ?? []) as PostRef[]) map[post.id] = post;
    setLinkedPosts(map);
  }, [conversation.id]);

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

  useEffect(() => {
    void load();
  }, [load]);

  // Mark the other person's messages as read.
  useEffect(() => {
    if (!user) return;
    void supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", conversation.id)
      .neq("sender_id", user.id)
      .is("read_at", null);
  }, [conversation.id, user, messages.length]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, otherTyping]);

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

      activeChannel = supabase
        .channel(`chat-${conversation.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversation.id}`,
          },
          () => void load(),
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
        .subscribe();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        removeActiveChannel();
      } else if (!activeChannel) {
        void subscribeToActiveChat();
        void load();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void subscribeToActiveChat();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      removeActiveChannel();
    };
  }, [conversation.id, user?.id, load]);

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
      toast.error("Messaging needs the Mid or Full plan");
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
      .select("id")
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
    void notify({
      recipientIds: otherId,
      title: `New message from ${other?.full_name ?? "a student"}`,
      body: text.slice(0, 120),
      url: `/messages?c=${conversation.id}`,
      kind: "message",
      eventId: insertedMessage.id,
    });
    await load();
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
        <div>
          <Link to="/u/$id" params={{ id: otherId }}>
            <p className="text-sm font-semibold hover:underline">{other?.full_name ?? "Student"}</p>
          </Link>
          <p className="text-xs text-muted-foreground">
            {otherTyping ? "typing…" : other?.major || "MKU Pulse"}
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          const quoted = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
          const linkedPost = m.post_id ? linkedPosts[m.post_id] : undefined;
          return (
            <div
              key={m.id}
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
                }`}
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
    </div>
  );
}
