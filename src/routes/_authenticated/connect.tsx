import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Heart, Loader2, Star, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify";
import { useCampus } from "@/hooks/useCampus";
import { StoredImage, UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  countToday,
  calculateRoommateCompatibility,
  fetchProfiles,
  getOrCreateConversation,
  type MiniProfile,
} from "@/lib/campus-data";

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

type SwipeAction = "like" | "pass" | "super_like";
type ChangeableSwipeAction = "like" | "pass";
type ConnectTab = "discover" | "matches" | "history";
const CANDIDATE_PAGE_SIZE = 20;

interface SwipeRow {
  swipee_id: string;
  action: SwipeAction;
  created_at: string;
}

function ConnectPage() {
  const { user, profile, limits, tier } = useCampus();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ConnectTab>("discover");
  const [deck, setDeck] = useState<MiniProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMoreCandidates, setLoadingMoreCandidates] = useState(false);
  const [hasMoreCandidates, setHasMoreCandidates] = useState(true);
  const [swipesToday, setSwipesToday] = useState(0);
  const [superToday, setSuperToday] = useState(0);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [matchProfiles, setMatchProfiles] = useState<Record<string, MiniProfile>>({});
  const [swipeHistory, setSwipeHistory] = useState<SwipeRow[]>([]);
  const [historyProfiles, setHistoryProfiles] = useState<Record<string, MiniProfile>>({});
  const [updatingSwipe, setUpdatingSwipe] = useState<string | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const candidateOffset = useRef(0);
  const seenProfileIds = useRef(new Set<string>());
  const queuedProfileIds = useRef(new Set<string>());
  const matchesRequestGeneration = useRef(0);
  const historyRequestGeneration = useRef(0);

  const loadDeck = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setHasMoreCandidates(true);
    candidateOffset.current = 0;
    queuedProfileIds.current = new Set<string>();
    const { data: swiped, error: swipeError } = await supabase
      .from("swipes")
      .select("swipee_id, action, created_at")
      .eq("swiper_id", user.id);
    if (swipeError) {
      toast.error(swipeError.message);
      setDeck([]);
      setHasMoreCandidates(false);
      setLoading(false);
      return;
    }
    const seen = new Set((swiped ?? []).map((s) => s.swipee_id as string));
    seen.add(user.id);
    seenProfileIds.current = seen;

    const query = supabase
      .from("profiles")
      .select(
        "id, full_name, avatar_url, major, year_of_study, bio, interests, tier, is_banned, is_private",
      )
      .eq("is_banned", false)
      .eq("is_private", false);
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(0, CANDIDATE_PAGE_SIZE - 1);
    if (error) {
      toast.error(error.message);
      setDeck([]);
      setHasMoreCandidates(false);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as (MiniProfile & { is_banned: boolean })[];
    candidateOffset.current = rows.length;
    const list = rows.filter((person) => !seen.has(person.id));
    queuedProfileIds.current = new Set(list.map((person) => person.id));
    setDeck(list.sort(() => Math.random() - 0.5));
    setHasMoreCandidates(rows.length === CANDIDATE_PAGE_SIZE);
    setSwipesToday(await countToday("swipes", "swiper_id", user.id));
    const supers = (swiped ?? []).filter(
      (swipe) =>
        swipe.action === "super_like" &&
        new Date(swipe.created_at as string).toDateString() === new Date().toDateString(),
    ).length;
    setSuperToday(supers);
    setLoading(false);
  }, [user]);

  const loadMoreCandidates = async () => {
    if (!user || loadingMoreCandidates || !hasMoreCandidates) return;
    setLoadingMoreCandidates(true);
    const query = supabase
      .from("profiles")
      .select(
        "id, full_name, avatar_url, major, year_of_study, bio, interests, tier, is_banned, is_private",
      )
      .eq("is_banned", false)
      .eq("is_private", false);
    const offset = candidateOffset.current;
    try {
      const { data, error } = await query
        .order("id", { ascending: true })
        .range(offset, offset + CANDIDATE_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as (MiniProfile & { is_banned: boolean })[];
      candidateOffset.current = offset + rows.length;
      setHasMoreCandidates(rows.length === CANDIDATE_PAGE_SIZE);
      const next = rows
        .filter(
          (person) =>
            !seenProfileIds.current.has(person.id) && !queuedProfileIds.current.has(person.id),
        )
        .sort(() => Math.random() - 0.5);
      for (const person of next) queuedProfileIds.current.add(person.id);
      setDeck((currentDeck) => [...currentDeck, ...next]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load more candidates");
    } finally {
      setLoadingMoreCandidates(false);
    }
  };

  const loadMatches = useCallback(async () => {
    if (!user) return;
    const generation = ++matchesRequestGeneration.current;
    setLoadingMatches(true);
    try {
      const { data, error } = await supabase
        .from("matches")
        .select("id, user_a, user_b, created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (generation !== matchesRequestGeneration.current) return;
      const rows = (data ?? []) as MatchRow[];
      setMatches(rows);
      const others = rows.map((match) => (match.user_a === user.id ? match.user_b : match.user_a));
      const profiles = await fetchProfiles(others);
      if (generation === matchesRequestGeneration.current) setMatchProfiles(profiles);
    } catch (error) {
      if (generation === matchesRequestGeneration.current) {
        toast.error(error instanceof Error ? error.message : "Could not load matches");
      }
    } finally {
      if (generation === matchesRequestGeneration.current) setLoadingMatches(false);
    }
  }, [user]);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    const generation = ++historyRequestGeneration.current;
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("swipes")
        .select("swipee_id, action, created_at")
        .eq("swiper_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      if (generation !== historyRequestGeneration.current) return;
      const rows = (data ?? []) as SwipeRow[];
      setSwipeHistory(rows);
      const profiles = await fetchProfiles(rows.map((row) => row.swipee_id));
      if (generation === historyRequestGeneration.current) setHistoryProfiles(profiles);
    } catch (error) {
      if (generation === historyRequestGeneration.current) {
        toast.error(error instanceof Error ? error.message : "Could not load swipe history");
      }
    } finally {
      if (generation === historyRequestGeneration.current) setLoadingHistory(false);
    }
  }, [user]);

  useEffect(() => {
    void loadDeck();
  }, [loadDeck]);

  useEffect(() => {
    if (tab !== "history") return;
    void loadHistory();
    return () => {
      historyRequestGeneration.current += 1;
    };
  }, [tab, loadHistory]);

  useEffect(() => {
    if (!user?.id || tab !== "matches") return;
    void loadMatches();
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadMatches();
      }, 300);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    window.addEventListener("focus", scheduleRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", scheduleRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      matchesRequestGeneration.current += 1;
    };
  }, [user?.id, loadMatches, tab]);

  const current = deck[0];
  const compatibility = current
    ? calculateRoommateCompatibility(
        profile?.interests,
        current.interests,
        profile?.year_of_study,
        current.year_of_study,
      )
    : null;
  const outOfSwipes = swipesToday >= limits.swipesPerDay;

  const swipe = async (action: SwipeAction) => {
    if (!user || !current) return;
    if (outOfSwipes) {
      toast.error(`Daily swipe limit reached on the ${limits.label} plan`);
      return;
    }
    if (action === "super_like" && superToday >= limits.superLikesPerDay) {
      toast.error("No super likes left today");
      return;
    }
    setDeck((items) => items.slice(1));
    const { error } = await supabase
      .from("swipes")
      .insert({ swiper_id: user.id, swipee_id: current.id, action });
    if (error) {
      setDeck((items) => [current, ...items.filter((item) => item.id !== current.id)]);
      toast.error(error.message);
      return;
    }
    seenProfileIds.current.add(current.id);
    setSwipesToday((count) => count + 1);
    if (action === "super_like") setSuperToday((count) => count + 1);
    if (action !== "pass") {
      // The database creates the match on a mutual like — tell them if it happened.
      const [a, b] = user.id < current.id ? [user.id, current.id] : [current.id, user.id];
      const { data: match } = await supabase
        .from("matches")
        .select("id")
        .eq("user_a", a)
        .eq("user_b", b)
        .eq("is_active", true)
        .maybeSingle();
      if (match) {
        void notify({
          recipientIds: current.id,
          title: "It's a match!",
          body: "You matched with someone on MKU Pulse.",
          url: "/connect",
          eventId: match.id,
          kind: "match",
        });
      }
    }
  };

  const changeVote = async (row: SwipeRow, action: ChangeableSwipeAction) => {
    if (!user || updatingSwipe) return;
    historyRequestGeneration.current += 1;
    setLoadingHistory(false);
    setUpdatingSwipe(row.swipee_id);
    const { error } = await supabase
      .from("swipes")
      .update({ action })
      .eq("swiper_id", user.id)
      .eq("swipee_id", row.swipee_id);
    setUpdatingSwipe(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSwipeHistory((rows) =>
      rows.map((item) => (item.swipee_id === row.swipee_id ? { ...item, action } : item)),
    );
    toast.success(action === "like" ? "Vote changed to Like" : "Vote changed to Pass");

    if (row.action === "pass" && action === "like") {
      const [a, b] = user.id < row.swipee_id ? [user.id, row.swipee_id] : [row.swipee_id, user.id];
      const { data: match } = await supabase
        .from("matches")
        .select("id")
        .eq("user_a", a)
        .eq("user_b", b)
        .eq("is_active", true)
        .maybeSingle();
      if (match) {
        void notify({
          recipientIds: row.swipee_id,
          title: "It's a match!",
          body: "You matched with someone on MKU Pulse.",
          url: "/connect",
          eventId: match.id,
          kind: "match",
        });
      }
    }
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
      void navigate({ to: "/messages", search: { c: id, p: undefined } });
    } catch {
      toast.error("Could not open that chat");
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 16) return;
    setDragX(dx);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    dragStart.current = null;
    setDragging(false);
    if (Math.abs(dx) >= 100) {
      suppressClick.current = true;
      void swipe(dx > 0 ? "like" : "pass");
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 500);
    }
    setDragX(0);
  };

  const outOfSuperLikes = superToday >= limits.superLikesPerDay;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold">Connect</h1>
        <p className="text-sm text-muted-foreground">
          {Math.max(0, limits.swipesPerDay - swipesToday)} swipes left today
          {limits.superLikesPerDay > 0
            ? ` · ${Math.max(0, limits.superLikesPerDay - superToday)} super likes`
            : ""}
          {tier === "free" ? " · upgrade for more" : ""}
        </p>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as ConnectTab)}>
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="discover" className="min-h-11">
            Discover
          </TabsTrigger>
          <TabsTrigger value="matches" className="min-h-11">
            Matches
          </TabsTrigger>
          <TabsTrigger value="history" className="min-h-11">
            Swiped / Passed
          </TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="mt-5">
          <section>
            <div className="flex justify-center">
              {loading ? (
                <Loader2 className="my-16 size-6 animate-spin text-muted-foreground" />
              ) : !current ? (
                <div className="my-16 flex max-w-sm flex-col items-center gap-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    {hasMoreCandidates
                      ? "You’ve reached the end of this batch. Load another group of students."
                      : "You've seen everyone for now. Check back later as more students join."}
                  </p>
                  {hasMoreCandidates && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => void loadMoreCandidates()}
                      disabled={loadingMoreCandidates}
                    >
                      {loadingMoreCandidates && (
                        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      )}
                      {loadingMoreCandidates ? "Loading candidates…" : "Load more candidates"}
                    </Button>
                  )}
                </div>
              ) : (
                <div
                  className="relative w-full max-w-sm touch-pan-y select-none overflow-hidden rounded-3xl border border-border bg-card shadow-sm"
                  style={{
                    transform: `translateX(${dragX}px) rotate(${Math.max(-14, Math.min(14, dragX / 18))}deg)`,
                    transition: dragging ? "none" : "transform 180ms ease-out",
                    touchAction: "pan-y",
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    dragStart.current = null;
                    setDragging(false);
                    setDragX(0);
                  }}
                  onClickCapture={(event) => {
                    if (suppressClick.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      suppressClick.current = false;
                    }
                  }}
                >
                  {dragX > 12 && (
                    <span
                      className="pointer-events-none absolute left-5 top-5 z-10 rotate-[-12deg] rounded-lg border-2 border-emerald-500 bg-emerald-500/90 px-3 py-1 text-lg font-black tracking-widest text-white shadow-lg"
                      style={{ opacity: Math.min(1, dragX / 90) }}
                    >
                      LIKE
                    </span>
                  )}
                  {dragX < -12 && (
                    <span
                      className="pointer-events-none absolute right-5 top-5 z-10 rotate-[12deg] rounded-lg border-2 border-red-500 bg-red-500/90 px-3 py-1 text-lg font-black tracking-widest text-white shadow-lg"
                      style={{ opacity: Math.min(1, Math.abs(dragX) / 90) }}
                    >
                      PASS
                    </span>
                  )}
                  <Link
                    to="/u/$id"
                    params={{ id: current.id }}
                    aria-label={`View ${current.full_name}'s profile`}
                    draggable={false}
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
                    {compatibility && (
                      <div className="mt-3 space-y-2">
                        <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                          🏠 {compatibility.percentage}% Roommate / Campus Match
                        </Badge>
                        {compatibility.sharedInterests.length > 0 && (
                          <div
                            className="flex flex-wrap items-center gap-1.5"
                            aria-label="Shared interests"
                          >
                            <span className="text-xs text-muted-foreground">Shared:</span>
                            {compatibility.sharedInterests.map((interest) => (
                              <Badge key={interest} variant="outline" className="text-xs">
                                #{interest.replace(/\s+/g, "")}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1">
                      {(current.interests ?? []).slice(0, 6).map((interest) => (
                        <Badge key={interest} variant="secondary">
                          {interest}
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
                          disabled={outOfSuperLikes}
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
        </TabsContent>

        <TabsContent value="matches" className="mt-5">
          <section>
            {loadingMatches && matches.length === 0 ? (
              <Loader2 className="mx-auto my-12 size-6 animate-spin text-muted-foreground" />
            ) : matches.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No matches yet — keep swiping.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {matches.map((match) => {
                  const otherId = match.user_a === user?.id ? match.user_b : match.user_a;
                  const person = matchProfiles[otherId];
                  return (
                    <div
                      key={match.id}
                      className="rounded-2xl border border-border bg-card p-3 text-left"
                    >
                      <Link to="/u/$id" params={{ id: otherId }} className="block">
                        <UserAvatar
                          path={person?.avatar_url}
                          name={person?.full_name ?? "Student"}
                          className="size-14"
                        />
                        <p className="mt-2 truncate text-sm font-semibold hover:underline">
                          {person?.full_name ?? "Student"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {person?.major || "Student"}
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
        </TabsContent>

        <TabsContent value="history" className="mt-5">
          <section>
            {loadingHistory && swipeHistory.length === 0 ? (
              <Loader2 className="mx-auto my-12 size-6 animate-spin text-muted-foreground" />
            ) : swipeHistory.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Profiles you pass or like will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {swipeHistory.map((row) => {
                  const person = historyProfiles[row.swipee_id];
                  const status =
                    row.action === "super_like"
                      ? "Superliked"
                      : row.action === "like"
                        ? "Liked"
                        : "Passed";
                  const nextAction: ChangeableSwipeAction = row.action === "pass" ? "like" : "pass";
                  return (
                    <li key={row.swipee_id} className="flex items-center gap-3 p-3 sm:p-4">
                      <Link to="/u/$id" params={{ id: row.swipee_id }} className="shrink-0">
                        <UserAvatar
                          path={person?.avatar_url}
                          name={person?.full_name ?? "Student"}
                          className="size-12"
                        />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <Link to="/u/$id" params={{ id: row.swipee_id }}>
                          <p className="truncate text-sm font-semibold hover:underline">
                            {person?.full_name ?? "Student"}
                          </p>
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {person?.major || "Student"}
                          {person?.year_of_study ? ` · Year ${person.year_of_study}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          row.action === "pass"
                            ? "text-muted-foreground"
                            : "bg-primary/10 text-primary"
                        }
                      >
                        {status}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 shrink-0"
                        disabled={updatingSwipe === row.swipee_id}
                        onClick={() => void changeVote(row, nextAction)}
                        aria-label={`Change ${status.toLowerCase()} vote for ${person?.full_name ?? "student"} to ${nextAction}`}
                      >
                        {updatingSwipe === row.swipee_id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : nextAction === "like" ? (
                          <>
                            <Heart className="mr-1 size-4" aria-hidden="true" /> Like
                          </>
                        ) : (
                          <>
                            <X className="mr-1 size-4" aria-hidden="true" /> Pass
                          </>
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
