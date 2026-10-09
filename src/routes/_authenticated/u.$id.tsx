import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "@/lib/toast";
import {
  ArrowLeft,
  ChevronDown,
  GraduationCap,
  Loader2,
  MessageCircle,
  RotateCcw,
  Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SafetyMenu } from "@/components/SafetyMenu";
import { isBlockedWith } from "@/lib/blocks";
import { useCampus } from "@/hooks/useCampus";
import { PostCard, type PostRow } from "@/components/PostCard";
import { StoredImage, UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getOrCreateConversation } from "@/lib/campus-data";
import { TIER_LIMITS, type Tier } from "@/lib/campus";
import { ReceivedCompliments, SendCompliment } from "@/components/ComplimentsPanel";

export const Route = createFileRoute("/_authenticated/u/$id")({
  head: () => ({
    meta: [
      { title: "Student profile — MKU Pulse" },
      {
        name: "description",
        content: "View a student's campus profile: course, year, interests and recent posts.",
      },
      { property: "og:title", content: "Student profile — MKU Pulse" },
      {
        property: "og:description",
        content: "See a student's profile and recent posts on MKU Pulse.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicProfilePage,
});

interface PublicProfile {
  mku_verified?: boolean;
  id: string;
  streak_count?: number;
  full_name: string;
  avatar_url: string | null;
  major: string;
  year_of_study: number;
  bio: string;
  interests: string[] | null;
  tier: Tier;
  is_private: boolean;
}

interface LocalRecentPost {
  id: string;
  content: string;
  created_at: number;
}

function readLocalRecentPosts(): LocalRecentPost[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem("mku_recent_posts") ?? "[]");
    if (!Array.isArray(value)) return [];
    return (value as Partial<LocalRecentPost>[])
      .filter(
        (draft): draft is LocalRecentPost =>
          typeof draft.id === "string" &&
          typeof draft.content === "string" &&
          typeof draft.created_at === "number" &&
          Number.isFinite(draft.created_at) &&
          Math.abs(draft.created_at) < 8.64e15,
      )
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function PublicProfilePage() {
  const { id } = useParams({ from: "/_authenticated/u/$id" });
  const { user } = useCampus();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [recentPosts, setRecentPosts] = useState<LocalRecentPost[]>([]);
  const [isMentor, setIsMentor] = useState(false);
  const [loading, setLoading] = useState(true);

  const mine = user?.id === id;
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!user?.id || user.id === id) return;
    void isBlockedWith(user.id, id).then(setBlocked);
  }, [user?.id, id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      const [{ data: p }, { data: mentor }, { data: postRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, full_name, avatar_url, major, year_of_study, bio, interests, tier, is_private, streak_count, mku_verified",
          )
          .eq("id", id)
          .maybeSingle(),
        supabase.from("mentors").select("user_id").eq("user_id", id).maybeSingle(),
        supabase
          .from("posts")
          .select("id, user_id, content, image_url, video_url, is_announcement, created_at")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (!active) return;
      setProfile((p as PublicProfile) ?? null);
      setIsMentor(Boolean(mentor));
      setPosts((postRows ?? []) as PostRow[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!mine || typeof window === "undefined") {
      setRecentPosts([]);
      return;
    }
    setRecentPosts(readLocalRecentPosts());
  }, [mine, id]);

  const message = async () => {
    if (!user || mine) return;
    try {
      const cid = await getOrCreateConversation(user.id, id);
      void navigate({
        to: "/messages",
        search: {
          c: cid,
          p: undefined,
          notification_event: undefined,
          notification_kind: undefined,
        },
      });
    } catch {
      toast.error("Could not open that chat");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="font-display text-xl font-bold">Profile unavailable</h1>
        <p className="text-sm text-muted-foreground">
          This student may have left campus or set their profile to private.
        </p>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => void navigate({ to: "/feed" })}
        >
          Back to feed
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="min-h-11 -ml-2"
        onClick={() => void navigate({ to: "/feed" })}
      >
        <ArrowLeft className="mr-1 size-4" aria-hidden="true" /> Back
      </Button>

      <header className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {profile.avatar_url ? (
            <StoredImage
              bucket="avatars"
              path={profile.avatar_url}
              alt={profile.full_name}
              className="size-28 rounded-full object-cover"
            />
          ) : (
            <UserAvatar path={null} name={profile.full_name} className="size-28" />
          )}
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h1 className="font-display text-2xl font-bold">{profile.full_name}</h1>
            {profile.mku_verified && (
              <Badge className="mt-1">✓ Verified MKU Student</Badge>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              Year {profile.year_of_study} · {profile.major || "Student"}
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
              {isMentor && (
                <Badge className="bg-accent text-accent-foreground">
                  <GraduationCap className="mr-1 size-3" aria-hidden="true" /> Mentor
                </Badge>
              )}
              {(profile.streak_count ?? 0) > 1 && (
                <Badge variant="secondary">🔥 {profile.streak_count}-day streak</Badge>
              )}
              {profile.tier !== "free" && (
                <Badge variant="secondary">
                  <Star className="mr-1 size-3" aria-hidden="true" />
                  {TIER_LIMITS[profile.tier].label}
                </Badge>
              )}
            </div>
            {profile.bio && <p className="mt-3 text-sm">{profile.bio}</p>}
            {(profile.interests ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1 sm:justify-start">
                {(profile.interests ?? []).map((i) => (
                  <Badge key={i} variant="secondary">
                    {i}
                  </Badge>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-center gap-2 sm:justify-start">
              {mine ? (
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void navigate({ to: "/profile" })}
                >
                  Edit your profile
                </Button>
              ) : (
                <>
                  {!blocked && (
                    <Button className="min-h-11" onClick={message}>
                      <MessageCircle className="mr-2 size-4" aria-hidden="true" /> Message
                    </Button>
                  )}
                  {user && (
                    <SafetyMenu
                      me={user.id}
                      other={id}
                      name={profile?.full_name}
                      onChange={(s) => setBlocked(s === "blocked")}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {mine ? <ReceivedCompliments /> : user && <SendCompliment recipientId={id} myId={user.id} />}

      {mine && recentPosts.length > 0 && (
        <details className="rounded-2xl border border-border bg-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold [&::-webkit-details-marker]:hidden">
            <span>Expired or Unsold Posts (Saved Locally)</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </summary>
          <div className="space-y-3 px-4 pb-4">
            <p className="text-sm text-muted-foreground">
              Posts expire after 24 hours to keep the feed fresh. Have an unsold item or vacant
              room?
            </p>
            {recentPosts.map((draft) => (
              <div
                key={draft.id}
                className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm">
                    {draft.content || "No text content was saved for this post."}
                  </p>
                  <time
                    className="mt-1 block text-xs text-muted-foreground"
                    dateTime={new Date(draft.created_at).toISOString()}
                  >
                    Saved {new Date(draft.created_at).toLocaleString()}
                  </time>
                </div>
                <Button
                  className="min-h-11 shrink-0"
                  onClick={() => void navigate({ to: "/feed", search: { relist: draft.content } })}
                >
                  <RotateCcw className="mr-2 size-4" aria-hidden="true" /> Relist Post
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}

      <section className="space-y-4">
        <h2 className="font-display text-lg font-bold">Posts</h2>
        {posts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No posts yet.
          </p>
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              author={{
                id: profile.id,
                full_name: profile.full_name,
                avatar_url: profile.avatar_url,
                major: profile.major,
                year_of_study: profile.year_of_study,
                bio: profile.bio,
                interests: profile.interests ?? [],
                tier: profile.tier as never,
              }}
              onDeleted={(pid) => setPosts((list) => list.filter((x) => x.id !== pid))}
            />
          ))
        )}
      </section>
    </div>
  );
}
