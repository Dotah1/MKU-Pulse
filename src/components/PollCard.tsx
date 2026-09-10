import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BarChart3, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StoredImage } from "@/components/StoredMedia";
import { deletePollWithMedia } from "@/lib/media.functions";
import { timeAgo } from "@/lib/campus";

export interface PollRow {
  id: string;
  question: string;
  image_url: string | null;
  is_active: boolean;
  closes_at: string | null;
  created_at: string;
}

export interface PollOptionRow {
  id: string;
  poll_id: string;
  label: string;
  position: number;
}


export function PollCard({
  poll,
  options,
  onDeleted,
}: {
  poll: PollRow;
  options: PollOptionRow[];
  onDeleted?: (id: string) => void;
}) {
  const { user, isAdmin } = useCampus();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [myOption, setMyOption] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const closed =
    !poll.is_active || (poll.closes_at ? new Date(poll.closes_at).getTime() < Date.now() : false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("poll_votes")
      .select("option_id, user_id")
      .eq("poll_id", poll.id);
    const rows = (data ?? []) as { option_id: string; user_id: string }[];
    const map: Record<string, number> = {};
    for (const r of rows) map[r.option_id] = (map[r.option_id] ?? 0) + 1;
    setCounts(map);
    setTotal(rows.length);
    setMyOption(rows.find((r) => r.user_id === user?.id)?.option_id ?? null);
  }, [poll.id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`poll-${poll.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poll_votes", filter: `poll_id=eq.${poll.id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [poll.id, load]);

  const vote = async (optionId: string) => {
    if (!user || closed) return;
    setBusy(true);
    const { error } = await supabase
      .from("poll_votes")
      .upsert(
        { poll_id: poll.id, option_id: optionId, user_id: user.id },
        { onConflict: "poll_id,user_id" },
      );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMyOption(optionId);
    await load();
  };

  const removePoll = async () => {
    const { error } = await supabase.from("polls").delete().eq("id", poll.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Poll removed");
      onDeleted?.(poll.id);
    }
  };

  return (
    <article className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" aria-hidden="true" />
        <Badge variant="secondary">Poll</Badge>
        {closed && <Badge variant="outline">Closed</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{timeAgo(poll.created_at)}</span>
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 text-destructive"
            onClick={() => void removePoll()}
            aria-label="Delete poll"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      <h2 className="mt-2 font-display text-base font-semibold">{poll.question}</h2>

      <ul className="mt-3 space-y-2">
        {options.map((o) => {
          const n = counts[o.id] ?? 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          const chosen = myOption === o.id;
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={busy || closed}
                onClick={() => void vote(o.id)}
                className={`relative w-full overflow-hidden rounded-xl border px-3 py-3 text-left text-sm ${
                  chosen ? "border-primary bg-card" : "border-border bg-card hover:bg-secondary"
                } ${closed ? "cursor-default" : ""}`}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-primary/15"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
                <span className="relative flex items-center justify-between gap-3">
                  <span className={chosen ? "font-semibold text-primary" : ""}>{o.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {pct}% ({n})
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {total} {total === 1 ? "vote" : "votes"}
        {myOption ? " · your vote is saved, tap another choice to change it" : ""}
        {poll.closes_at && !closed ? ` · closes ${new Date(poll.closes_at).toLocaleString()}` : ""}
      </p>
    </article>
  );
}

/** Load the polls that should appear in the feed, newest first. */
export async function fetchFeedPolls(): Promise<{
  polls: PollRow[];
  options: Record<string, PollOptionRow[]>;
}> {
  const { data: polls } = await supabase
    .from("polls")
    .select("id, question, is_active, closes_at, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  const list = (polls ?? []) as PollRow[];
  if (list.length === 0) return { polls: [], options: {} };
  const { data: opts } = await supabase
    .from("poll_options")
    .select("id, poll_id, label, position")
    .in(
      "poll_id",
      list.map((p) => p.id),
    )
    .order("position", { ascending: true });
  const grouped: Record<string, PollOptionRow[]> = {};
  for (const o of (opts ?? []) as PollOptionRow[]) {
    (grouped[o.poll_id] ??= []).push(o);
  }
  return { polls: list, options: grouped };
}
