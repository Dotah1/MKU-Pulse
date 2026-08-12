import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sanitizeText, timeAgo } from "@/lib/campus";
import { fetchProfiles, type MiniProfile } from "@/lib/campus-data";

export const Route = createFileRoute("/_authenticated/messages")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search['c'] === "string" ? (search['c'] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Messages — Campus Connect" },
      {
        name: "description",
        content: "Your unified campus inbox with real-time chat and typing indicators.",
      },
      { property: "og:title", content: "Messages — Campus Connect" },
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
  read_at: string | null;
  created_at: string;
}

function MessagesPage() {
  const { user } = useCampus();
  const { c } = Route.useSearch();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [people, setPeople] = useState<Record<string, MiniProfile>>({});
  const [loading, setLoading] = useState(true);

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
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`inbox-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, load]);

  const active = conversations.find((x) => x.id === c);

  if (c && active) {
    const otherId = active.user_a === user?.id ? active.user_b : active.user_a;
    return (
      <ChatPane
        conversation={active}
        other={people[otherId]}
        onBack={() => void navigate({ to: "/messages", search: { c: undefined } })}
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
              <li key={conv.id}>
                <button
                  onClick={() => void navigate({ to: "/messages", search: { c: conv.id } })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary"
                >
                  <UserAvatar
                    path={p?.avatar_url}
                    name={p?.full_name ?? "Student"}
                    className="size-11"
                  />
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
  onBack,
}: {
  conversation: ConversationRow;
  other: MiniProfile | undefined;
  onBack: () => void;
}) {
  const { user, limits } = useCampus();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const otherId = useMemo(
    () => (conversation.user_a === user?.id ? conversation.user_b : conversation.user_a),
    [conversation, user?.id],
  );

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, read_at, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(300);
    setMessages((data ?? []) as MessageRow[]);
  }, [conversation.id]);

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
  }, [conversation.id, user?.id, messages.length]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, otherTyping]);

  useEffect(() => {
    const channel = supabase
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
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversation.id, user?.id, load]);

  const lastTyped = useRef(0);
  const onType = (value: string) => {
    setDraft(value);
    if (!user) return;
    const now = Date.now();
    if (now - lastTyped.current < 1500) return;
    lastTyped.current = now;
    void supabase
      .from("typing_state")
      .upsert({
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
    const { error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversation.id, sender_id: user.id, content: text });
    if (error) {
      setSending(false);
      toast.error(error.message);
      return;
    }
    await supabase
      .from("conversations")
      .update({ last_message: text, last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);
    setDraft("");
    setSending(false);
    await load();
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" className="min-h-11" onClick={onBack} aria-label="Back to inbox">
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <UserAvatar path={other?.avatar_url} name={other?.full_name ?? "Student"} className="size-9" />
        <div>
          <p className="text-sm font-semibold">{other?.full_name ?? "Student"}</p>
          <p className="text-xs text-muted-foreground">
            {otherTyping ? "typing…" : other?.major || "Campus Connect"}
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  mine
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                <p className={`mt-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {timeAgo(m.created_at)}
                  {mine ? (m.read_at ? " · Read" : " · Sent") : ""}
                </p>
              </div>
            </div>
          );
        })}
        {otherTyping && <p className="text-xs text-muted-foreground">typing…</p>}
        <div ref={bottom} />
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
        <Button onClick={() => void send()} disabled={sending} className="min-h-11" aria-label="Send">
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
