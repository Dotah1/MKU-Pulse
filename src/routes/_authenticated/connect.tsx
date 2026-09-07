import { useCallback, useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Heart, Loader2, Star, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify";
import { useCampus } from "@/hooks/useCampus";
import { StoredImage, UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { countToday, fetchProfiles, getOrCreateConversation, type MiniProfile } from "@/lib/campus-data";

export const Route = createFileRoute("/_authenticated/connect")({
  head: () => ({
    meta: [
      { title: "Connect — MKU Pulse" },
      {
        name: "description",
        content: "Swipe through students on your campus, match, and start chatting.",
      },
      { property: "og:title", content: "Connect — MKU Pulse" },
      { property: "og:description", content: "Match with students on your campus." },
    ],
  }),
  component: ConnectPage,
});

interface MatchRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
}

function ConnectPage() {
  const { user, profile, limits, tier } = useCampus();
  const navigate = useNavigate();
  const [deck, setDeck] = useState<MiniProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [swipesToday, setSwipesToday] = useState(0);
  const [superToday, setSuperToday] = useState(0);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [matchProfiles, setMatchProfiles] = useState<Record<string, MiniProfile>>({});

  const loadDeck = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: swiped } = await supabase
      .from("swipes")
      .select("swipee_id, action, created_at")
      .eq("swiper_id", user.id);
    const seen = new Set((swiped ?? []).map((s) => s.swipee_id as string));
    seen.add(user.id);

    // Only show the opposite gender.
    const wanted = profile?.gender === "male" ? "female" : profile?.gender === "female" ? "male" : null;

    let query = supabase
      .from("profiles")
      .select("id, full_name, avatar_url, major, year_of_study, bio, interests, tier, is_banned, is_private")
      .eq("is_banned", false)
      .eq("is_private", false);
    if (wanted) query = query.eq("gender", wanted);
    const { data } = await query.limit(200);

    const list = ((data ?? []) as (MiniProfile & { is_banned: boolean })[]).filter(
      (p) => !seen.has(p.id),
    );
    setDeck(list.sort(() => Math.random() - 0.5).slice(0, 40));
    setSwipesToday(await countToday("swipes", "swiper_id", user.id));
    const supers = (swiped ?? []).filter(
      (s) => s.action === "super_like" && new Date(s.created_at as string).toDateString() === new Date().toDateString(),
    ).length;
    setSuperToday(supers);
    setLoading(false);
  }, [user?.id, profile?.gender]);


  const loadMatches = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("matches")
      .select("id, user_a, user_b, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as MatchRow[];
    setMatches(rows);
    const others = rows.map((m) => (m.user_a === user.id ? m.user_b : m.user_a));
    setMatchProfiles(await fetchProfiles(others));
  }, [user?.id]);

  useEffect(() => {
    void loadDeck();
    void loadMatches();
  }, [loadDeck, loadMatches]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`match-live-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, () => {
        void loadMatches();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, loadMatches]);

  const current = deck[0];
  const outOfSwipes = swipesToday >= limits.swipesPerDay;

  const swipe = async (action: "like" | "pass" | "super_like") => {
    if (!user || !current) return;
    if (outOfSwipes) {
      toast.error(`Daily swipe limit reached on the ${limits.label} plan`);
      return;
    }
    if (action === "super_like" && superToday >= limits.superLikesPerDay) {
      toast.error("No super likes left today");
      return;
    }
    setDeck((d) => d.slice(1));
    const { error } = await supabase
      .from("swipes")
      .insert({ swiper_id: user.id, swipee_id: current.id, action });
    if (error) {
      toast.error(error.message);
      return;
    }
    setSwipesToday((n) => n + 1);
    if (action === "super_like") setSuperToday((n) => n + 1);
    if (action !== "pass") {
      // The database creates the match on a mutual like — tell them if it happened.
      const [a, b] = user.id < current.id ? [user.id, current.id] : [current.id, user.id];
      const { data: match } = await supabase
        .from("matches")
        .select("id")
        .eq("user_a", a)
        .eq("user_b", b)
        .maybeSingle();
      if (match) {
        void notify({
          recipientIds: current.id,
          title: "It's a match!",
          body: "You matched with someone on MKU Pulse.",
          url: "/connect",
          kind: "match",
        });
      }
    }
    await loadMatches();
  };

  const openChat = async (otherId: string) => {
    if (!user) return;
    if (!limits.canChatMatches) {
      toast.error("Chatting with matches needs the Mid or Full plan");
      void navigate({ to: "/profile" });
      return;
    }
    try {
      const id = await getOrCreateConversation(user.id, otherId);
      void navigate({ to: "/messages", search: { c: id } });
    } catch {
      toast.error("Could not open that chat");
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-2xl font-bold">Connect</h1>
        <p className="text-sm text-muted-foreground">
          {Math.max(0, limits.swipesPerDay - swipesToday)} swipes left today
          {limits.superLikesPerDay > 0
            ? ` · ${Math.max(0, limits.superLikesPerDay - superToday)} super likes`
            : ""}
          {tier === "free" ? " · upgrade for more" : ""}
        </p>

        <div className="mt-4 flex justify-center">
          {loading ? (
            <Loader2 className="my-16 size-6 animate-spin text-muted-foreground" />
          ) : !current ? (
            <p className="my-16 max-w-sm text-center text-sm text-muted-foreground">
              You've seen everyone for now. Check back later as more students join.
            </p>
          ) : (
            <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
              <Link
                to="/u/$id"
                params={{ id: current.id }}
                aria-label={`View ${current.full_name}'s profile`}
              >
                {current.avatar_url ? (
                  <StoredImage
                    bucket="avatars"
                    path={current.avatar_url}
                    alt={current.full_name}
                    className="h-96 w-full object-cover"
                  />

                ) : (
                  <div className="flex h-96 items-center justify-center bg-secondary">
                    <UserAvatar path={null} name={current.full_name} className="size-24" />
                  </div>
                )}
              </Link>
              <div className="p-4">
                <Link to="/u/$id" params={{ id: current.id }}>
                  <h2 className="font-display text-lg font-bold hover:underline">
                    {current.full_name}
                  </h2>
                </Link>
                <p className="text-sm text-muted-foreground">
                  Year {current.year_of_study} · {current.major || "Student"}
                </p>
                {current.bio && <p className="mt-2 text-sm">{current.bio}</p>}
                <div className="mt-3 flex flex-wrap gap-1">
                  {(current.interests ?? []).slice(0, 6).map((i) => (
                    <Badge key={i} variant="secondary">
                      {i}
                    </Badge>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    className="size-14 rounded-full p-0"
                    aria-label="Pass"
                    onClick={() => void swipe("pass")}
                  >
                    <X className="size-6" aria-hidden="true" />
                  </Button>
                  {limits.superLikesPerDay > 0 && (
                    <Button
                      variant="outline"
                      size="lg"
                      className="size-14 rounded-full border-accent p-0 text-accent"
                      aria-label="Super like"
                      onClick={() => void swipe("super_like")}
                    >
                      <Star className="size-6" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    size="lg"
                    className="size-16 rounded-full p-0"
                    aria-label="Like"
                    onClick={() => void swipe("like")}
                  >
                    <Heart className="size-7" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-bold">Your matches</h2>
        {matches.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No matches yet — keep swiping.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {matches.map((m) => {
              const otherId = m.user_a === user?.id ? m.user_b : m.user_a;
              const p = matchProfiles[otherId];
              return (
                <div
                  key={m.id}
                  className="rounded-2xl border border-border bg-card p-3 text-left"
                >
                  <Link to="/u/$id" params={{ id: otherId }} className="block">
                    <UserAvatar
                      path={p?.avatar_url}
                      name={p?.full_name ?? "Student"}
                      className="size-14"
                    />
                    <p className="mt-2 truncate text-sm font-semibold hover:underline">
                      {p?.full_name ?? "Student"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p?.major || "Student"}
                    </p>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 min-h-11 w-full"
                    onClick={() => void openChat(otherId)}
                  >
                    Message
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
