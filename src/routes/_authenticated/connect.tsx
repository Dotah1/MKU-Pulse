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
type SwipeDirection = "like" | "pass";

interface DragState {
  x: number;
  y: number;
  width: number;
  axis: "undecided" | "horizontal" | "vertical";
}

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
  const [swipesToday, setSwipesToday] = useState(0);
  const [superToday, setSuperToday] = useState(0);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [matchProfiles, setMatchProfiles] = useState<Record<string, MiniProfile>>({});
  const [swipeHistory, setSwipeHistory] = useState<SwipeRow[]>([]);
  const [historyProfiles, setHistoryProfiles] = useState<Record<string, MiniProfile>>({});
  const [updatingSwipe, setUpdatingSwipe] = useState<string | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exitAction, setExitAction] = useState<SwipeDirection | null>(null);
  const dragStart = useRef<DragState | null>(null);
  const exitActionRef = useRef<SwipeDirection | null>(null);
  const exitTimeout = useRef<number | null>(null);
  const suppressClick = useRef(false);

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
    const wanted =
      profile?.gender === "male" ? "female" : profile?.gender === "female" ? "male" : null;

    let query = supabase
      .from("profiles")
      .select(
        "id, full_name, avatar_url, major, year_of_study, bio, interests, tier, is_banned, is_private",
      )
      .eq("is_banned", false)
      .eq("is_private", false);
    if (wanted) query = query.eq("gender", wanted);
    const { data } = await query.limit(200);

    const list = ((data ?? []) as (MiniProfile & { is_banned: boolean })[]).filter(
      (person) => !seen.has(person.id),
    );
    setDeck(list.sort(() => Math.random() - 0.5).slice(0, 40));
    setSwipesToday(await countToday("swipes", "swiper_id", user.id));
    const supers = (swiped ?? []).filter(
      (swipe) =>
        swipe.action === "super_like" &&
        new Date(swipe.created_at as string).toDateString() === new Date().toDateString(),
    ).length;
    setSuperToday(supers);
    setLoading(false);
  }, [user, profile?.gender]);

  const loadMatches = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("matches")
      .select("id, user_a, user_b, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as MatchRow[];
    setMatches(rows);
    const others = rows.map((match) => (match.user_a === user.id ? match.user_b : match.user_a));
    setMatchProfiles(await fetchProfiles(others));
  }, [user]);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("swipes")
      .select("swipee_id, action, created_at")
      .eq("swiper_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = (data ?? []) as SwipeRow[];
    setSwipeHistory(rows);
    setHistoryProfiles(await fetchProfiles(rows.map((row) => row.swipee_id)));
  }, [user]);

  useEffect(() => {
    void loadDeck();
    void loadMatches();
    void loadHistory();
  }, [loadDeck, loadMatches, loadHistory]);

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
  }, [user, loadMatches]);

  const current = deck[0];
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
          kind: "match",
        });
      }
    }
    await Promise.all([loadMatches(), loadHistory()]);
  };

  const finishSwipeExit = () => {
    const action = exitActionRef.current;
    if (!action) return;
    exitActionRef.current = null;
    if (exitTimeout.current !== null) window.clearTimeout(exitTimeout.current);
    exitTimeout.current = null;
    setExitAction(null);
    setDragX(0);
    void swipe(action);
  };

  const animateSwipe = (action: SwipeDirection, cardWidth = 320) => {
    if (!current || exitActionRef.current) return;
    if (outOfSwipes) {
      toast.error(`Daily swipe limit reached on the ${limits.label} plan`);
      setDragX(0);
      return;
    }
    exitActionRef.current = action;
    setExitAction(action);
    setDragging(false);
    setDragX(
      (action === "like" ? 1 : -1) * Math.max(window.innerWidth + cardWidth, cardWidth * 2.2),
    );
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 700);
    // Fallback for reduced-motion settings or browsers that omit transitionend.
    exitTimeout.current = window.setTimeout(finishSwipeExit, 400);
  };

  const changeVote = async (row: SwipeRow, action: ChangeableSwipeAction) => {
    if (!user || updatingSwipe) return;
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
          kind: "match",
        });
      }
    }
    await Promise.all([loadDeck(), loadMatches(), loadHistory()]);
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
    if (
      event.button !== 0 ||
      exitActionRef.current ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      width: bounds.width,
      axis: "undecided",
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.axis === "undecided") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      start.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? "horizontal" : "vertical";
    }
    if (start.axis !== "horizontal") return;
    event.preventDefault();
    const resistanceStart = start.width * 0.55;
    const magnitude = Math.abs(dx);
    const resistedX =
      magnitude > resistanceStart
        ? Math.sign(dx) * (resistanceStart + (magnitude - resistanceStart) * 0.55)
        : dx;
    setDragX(resistedX);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    dragStart.current = null;
    setDragging(false);
    const threshold = Math.max(64, start.width * 0.23);
    if (start.axis === "horizontal" && Math.abs(dx) >= threshold) {
      animateSwipe(dx > 0 ? "like" : "pass", start.width);
    } else {
      setDragX(0);
    }
  };

  const likeProgress = Math.min(1, Math.pow(Math.max(0, dragX) / 88, 0.78));
  const passProgress = Math.min(1, Math.pow(Math.max(0, -dragX) / 88, 0.78));

  useEffect(
    () => () => {
      if (exitTimeout.current !== null) window.clearTimeout(exitTimeout.current);
    },
    [],
  );

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
            <div className="flex justify-center overflow-x-hidden">
              {loading ? (
                <Loader2 className="my-16 size-6 animate-spin text-muted-foreground" />
              ) : !current ? (
                <p className="my-16 max-w-sm text-center text-sm text-muted-foreground">
                  You've seen everyone for now. Check back later as more students join.
                </p>
              ) : (
                <div
                  className={`relative w-full max-w-sm cursor-grab touch-pan-y select-none overflow-hidden rounded-3xl border border-border bg-card shadow-sm motion-reduce:duration-0 ${
                    dragging
                      ? "cursor-grabbing transition-none"
                      : "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                  }`}
                  style={{
                    transform: `translate3d(${dragX}px, 0, 0) rotate(${Math.max(-16, Math.min(16, dragX * 0.055))}deg) scale(${dragging ? 1.012 : 1})`,
                    touchAction: "pan-y",
                  }}
                  aria-hidden={exitAction !== null}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    dragStart.current = null;
                    setDragging(false);
                    setDragX(0);
                  }}
                  onTransitionEnd={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      event.propertyName === "transform"
                    ) {
                      finishSwipeExit();
                    }
                  }}
                  onClickCapture={(event) => {
                    if (suppressClick.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      suppressClick.current = false;
                    }
                  }}
                >
                  <span
                    className="pointer-events-none absolute left-5 top-5 z-10 rounded-lg border-[3px] border-emerald-500 bg-emerald-500/90 px-3 py-1.5 text-lg font-black tracking-[0.18em] text-white shadow-lg transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none"
                    style={{
                      opacity: likeProgress,
                      transform: `rotate(-12deg) scale(${0.78 + likeProgress * 0.24})`,
                    }}
                    aria-hidden="true"
                  >
                    LIKE
                  </span>
                  <span
                    className="pointer-events-none absolute right-5 top-5 z-10 rounded-lg border-[3px] border-red-500 bg-red-500/90 px-3 py-1.5 text-lg font-black tracking-[0.18em] text-white shadow-lg transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none"
                    style={{
                      opacity: passProgress,
                      transform: `rotate(12deg) scale(${0.78 + passProgress * 0.24})`,
                    }}
                    aria-hidden="true"
                  >
                    PASS
                  </span>
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
                        onClick={() => animateSwipe("pass")}
                        disabled={exitAction !== null}
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
                          disabled={outOfSuperLikes || exitAction !== null}
                        >
                          <Star className="size-6" aria-hidden="true" />
                        </Button>
                      )}
                      <Button
                        size="lg"
                        className="size-16 rounded-full p-0"
                        aria-label="Like"
                        onClick={() => animateSwipe("like")}
                        disabled={exitAction !== null}
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
            {matches.length === 0 ? (
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
            {swipeHistory.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Profiles you pass or like will appear here.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {swipeHistory.map((row) => {
                  const person = historyProfiles[row.swipee_id];
                  const status =
                    row.action === "super_like"
                      ? "Superliked"
                      : row.action === "like"
                        ? "Liked"
                        : "Passed";
                  const nextAction: ChangeableSwipeAction = row.action === "pass" ? "like" : "pass";
                  const statusColor =
                    row.action === "pass"
                      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                      : row.action === "super_like"
                        ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
                  return (
                    <li
                      key={row.swipee_id}
                      className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/20 sm:p-4"
                    >
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
                      <Badge variant="outline" className={`shrink-0 gap-1.5 ${statusColor}`}>
                        {row.action === "pass" ? (
                          <X className="size-3" aria-hidden="true" />
                        ) : row.action === "super_like" ? (
                          <Star className="size-3" aria-hidden="true" />
                        ) : (
                          <Heart className="size-3" aria-hidden="true" />
                        )}
                        <span>{status}</span>
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
