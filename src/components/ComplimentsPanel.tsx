import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import { Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { COMPLIMENT_OPTIONS, fetchProfiles, type MiniProfile } from "@/lib/campus-data";
import { notifyUser } from "@/lib/notifications.functions";
import { timeAgo } from "@/lib/campus";

/** Send an anonymous compliment to another student. */
export function SendCompliment({ recipientId, myId }: { recipientId: string; myId: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase
      .from("campus_crushes")
      .select("compliment_tag")
      .eq("sender_id", myId)
      .eq("recipient_id", recipientId)
      .maybeSingle()
      .then(({ data }) => setSent(data?.compliment_tag ?? null));
  }, [myId, recipientId]);

  const send = async (tag: string) => {
    setBusy(true);
    const { data: mutual, error } = await supabase.rpc("send_compliment", {
      _recipient: recipientId,
      _tag: tag,
    });
    setBusy(false);
    if (error) {
      toast.error("Could not send the compliment");
      return;
    }
    setSent(tag);
    const { data: complimentEvent } = await supabase
      .from("campus_crushes")
      .select("id")
      .eq("sender_id", myId)
      .eq("recipient_id", recipientId)
      .maybeSingle();
    if (!complimentEvent) return;
    if (mutual) {
      toast.success("It's a Mutual Crush! 💞 Check your messages.");
      void notifyUser({
        data: {
          recipientIds: [recipientId],
          title: "It's a Mutual Crush! 💞",
          body: "You and someone complimented each other. Say hi!",
          url: "/messages",
          kind: "compliment",
          eventId: complimentEvent.id,
        },
      }).catch(() => undefined);
    } else {
      toast.success("Compliment sent anonymously 💌");
      void notifyUser({
        data: {
          recipientIds: [recipientId],
          title: "Someone on campus sent you a compliment! 💌",
          body: `"${tag}"`,
          url: "/profile",
          kind: "compliment",
          eventId: complimentEvent.id,
        },
      }).catch(() => undefined);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="font-display text-base font-semibold">Send an anonymous compliment</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        They won't know it's you — unless they compliment you back.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {COMPLIMENT_OPTIONS.map((tag) => (
          <Button
            key={tag}
            size="sm"
            variant={sent === tag ? "default" : "outline"}
            disabled={busy}
            onClick={() => void send(tag)}
          >
            {tag}
          </Button>
        ))}
      </div>
    </section>
  );
}

interface Received {
  id: string;
  compliment_tag: string;
  created_at: string;
  is_revealed: boolean;
  sender_id: string | null;
}

/** Compliments the signed-in student has received. */
export function ReceivedCompliments() {
  const [items, setItems] = useState<Received[]>([]);
  const [people, setPeople] = useState<Record<string, MiniProfile>>({});

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc("my_compliments");
      const rows = (data ?? []) as Received[];
      setItems(rows);
      setPeople(await fetchProfiles(rows.map((r) => r.sender_id ?? "")));
    })();
  }, []);

  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        <Heart className="size-4 text-primary" aria-hidden="true" /> Compliments for you
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((c) => (
          <li key={c.id} className="rounded-xl bg-muted px-3 py-2 text-sm">
            <span className="font-medium">"{c.compliment_tag}"</span>
            <span className="ml-2 text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
            <div className="text-xs text-muted-foreground">
              {c.sender_id && people[c.sender_id] ? (
                <>
                  Mutual crush with{" "}
                  <Link to="/u/$id" params={{ id: c.sender_id }} className="text-primary underline">
                    {people[c.sender_id]?.full_name}
                  </Link>
                </>
              ) : (
                "From a secret admirer — compliment them back to reveal"
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
