import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Image as ImageIcon, Loader2, Video, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { PostCard, usePostAuthors, type PostRow } from "@/components/PostCard";
import { PollCard, fetchFeedPolls, type PollOptionRow, type PollRow } from "@/components/PollCard";
import { UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CampusToolsDialog } from "@/components/CampusToolsDialog";
import { POST_MEDIA_MAX_BYTES, POST_VIDEO_MAX_SECONDS, sanitizeText } from "@/lib/campus";
import { compressImageFile, uploadFile, videoDuration } from "@/lib/storage";
import { countToday } from "@/lib/campus-data";

const FEED_FILTERS = [
  { id: "all", label: "#All" },
  { id: "trending", label: "#Trending" },
  { id: "lost-and-found", label: "#LostAndFound" },
  { id: "confessions", label: "#Confessions" },
  { id: "hostel-vibes", label: "#HostelVibes" },
] as const;

type FeedFilter = (typeof FEED_FILTERS)[number]["id"];

function postMatchesFilter(content: string, filter: FeedFilter): boolean {
  if (filter === "all") return true;
  const text = content.toLowerCase();
  const patterns: Record<Exclude<FeedFilter, "all">, RegExp> = {
    trending: /#trending\b|\btrending\b|\bviral\b/i,
    "lost-and-found":
      /#lostandfound\b|#lost\b|#found\b|\blost\s+and\s+found\b|\b(?:lost|found)\s+(?:item|keys?|phone|wallet|id|card|book|bag)\b/i,
    confessions: /#confessions?\b|\bconfessions?\b/i,
    "hostel-vibes": /#hostelvibes\b|\bhostel(?:\s+vibes)?\b|\broommates?\b|\bdorm\b/i,
  };
  return patterns[filter].test(text);
}

export const Route = createFileRoute("/_authenticated/feed")({
  head: () => ({
    meta: [
      { title: "Campus feed — MKU Pulse" },
      {
        name: "description",
        content:
          "See what your campus is posting: updates, photos, clips, polls and announcements.",
      },
      { property: "og:title", content: "Campus feed — MKU Pulse" },
      { property: "og:description", content: "The live campus feed on MKU Pulse." },
    ],
  }),
  component: FeedPage,
});

function FeedPage() {
  const { user, profile, isAdmin, limits, tier } = useCampus();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [polls, setPolls] = useState<PollRow[]>([]);
  const [pollOptions, setPollOptions] = useState<Record<string, PollOptionRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [usedToday, setUsedToday] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FeedFilter>("all");
  const authors = usePostAuthors(posts);
  const filteredPosts = useMemo(
    () => posts.filter((post) => postMatchesFilter(post.content, activeFilter)),
    [posts, activeFilter],
  );

  const load = async () => {
    const [{ data, error }, pollData] = await Promise.all([
      supabase
        .from("posts")
        .select(
          "id, user_id, content, image_url, video_url, video_seconds, is_announcement, created_at",
        )
        .order("is_announcement", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60),
      fetchFeedPolls(),
    ]);
    if (error) toast.error(error.message);
    setPosts((data ?? []) as PostRow[]);
    setPolls(pollData.polls);
    setPollOptions(pollData.options);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!user) return;
    void countToday("posts", "user_id", user.id).then(setUsedToday);
  }, [user, posts.length]);

  const blockedUntil = profile?.post_block_until ?? null;
  const blocked = blockedUntil ? new Date(blockedUntil).getTime() > Date.now() : false;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Campus feed</h1>
          <p className="text-sm text-muted-foreground">
            {tier === "free"
              ? `${limits.postsPerDay - usedToday} of ${limits.postsPerDay} text posts left today · upgrade for photos & video`
              : `${Math.max(0, limits.postsPerDay - usedToday)} posts left today on your ${limits.label} plan`}
          </p>
        </div>
        <CampusToolsDialog />
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter posts by hashtag">
        {FEED_FILTERS.map((filter) => (
          <Button
            key={filter.id}
            type="button"
            size="sm"
            variant={activeFilter === filter.id ? "default" : "outline"}
            className="min-h-10 rounded-full"
            aria-pressed={activeFilter === filter.id}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {blocked && blockedUntil && (
        <p className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          An admin has paused your posting until {new Date(blockedUntil).toLocaleString()}.
        </p>
      )}

      {!blocked && (
        <Composer
          onPosted={() => {
            void load();
          }}
          usedToday={usedToday}
        />
      )}

      {polls.map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          options={pollOptions[poll.id] ?? []}
          onDeleted={(id) => setPolls((list) => list.filter((p) => p.id !== id))}
        />
      ))}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : posts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing here yet — be the first to post.
        </p>
      ) : filteredPosts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No posts match {FEED_FILTERS.find((filter) => filter.id === activeFilter)?.label} yet. Try
          another hashtag.
        </p>
      ) : (
        <div className="space-y-4">
          {filteredPosts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              author={authors[p.user_id]}
              onDeleted={(id) => setPosts((list) => list.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}

      {isAdmin && profile && (
        <p className="pb-4 text-center text-xs text-muted-foreground">
          Signed in as admin — you can post announcements, run polls and remove any post.
        </p>
      )}
    </div>
  );
}

function Composer({ onPosted, usedToday }: { onPosted: () => void; usedToday: number }) {
  const { user, profile, isAdmin, limits } = useCampus();
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"image" | "video" | null>(null);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preparingKind, setPreparingKind] = useState<"image" | "video" | null>(null);

  const atLimit = usedToday >= limits.postsPerDay;

  const pick = async (f: File | null, want: "image" | "video") => {
    if (!f || preparing) return;
    if (want === "image" && !limits.canPostImage) {
      toast.error("Photo posts need the Mid or Full plan");
      return;
    }
    if (want === "video" && !limits.canPostVideo) {
      toast.error("Video posts need the Full plan");
      return;
    }
    setPreparing(true);
    setPreparingKind(want);
    try {
      let preparedFile = f;
      let seconds: number | null = null;
      if (want === "image") {
        if (!f.type.startsWith("image/")) throw new Error("Choose an image file");
        preparedFile = await compressImageFile(f);
        if (preparedFile.size > POST_MEDIA_MAX_BYTES) {
          throw new Error("Compressed images must be under 25MB");
        }
      } else {
        if (!f.type.startsWith("video/")) throw new Error("Choose a video file");
        if (f.size > POST_MEDIA_MAX_BYTES) throw new Error("Videos must be under 25MB");
        const duration = await videoDuration(f);
        if (!Number.isFinite(duration) || duration <= 0)
          throw new Error("Could not read that video");
        if (duration > POST_VIDEO_MAX_SECONDS) {
          throw new Error(`Videos must be ${POST_VIDEO_MAX_SECONDS} seconds or shorter`);
        }
        seconds = Math.ceil(duration);
      }
      setFile(preparedFile);
      setKind(want);
      setClipSeconds(seconds);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare that file");
    } finally {
      setPreparing(false);
      setPreparingKind(null);
    }
  };

  const clearFile = () => {
    setFile(null);
    setKind(null);
    setClipSeconds(null);
  };

  const submit = async () => {
    if (!user) return;
    const text = sanitizeText(content, 1000);
    if (!text && !file) {
      toast.error("Write something or attach media");
      return;
    }
    if (atLimit) {
      toast.error("You've reached today's post limit — upgrade for more");
      return;
    }
    if (profile?.is_banned) {
      toast.error("Your account is restricted from posting");
      return;
    }
    setBusy(true);
    try {
      let imagePath: string | null = null;
      let videoPath: string | null = null;
      if (file && kind) {
        if (kind === "video") {
          if (!file.type.startsWith("video/") || file.size > POST_MEDIA_MAX_BYTES) {
            throw new Error("Videos must be valid and under 25MB");
          }
          const duration = await videoDuration(file);
          if (!Number.isFinite(duration) || duration <= 0 || duration > POST_VIDEO_MAX_SECONDS) {
            throw new Error(`Videos must be ${POST_VIDEO_MAX_SECONDS} seconds or shorter`);
          }
        }
        const path = await uploadFile("media", user.id, file, {
          alreadyCompressed: kind === "image",
        });
        if (kind === "image") imagePath = path;
        else videoPath = path;
      }
      const { error } = await supabase.from("posts").insert({
        user_id: user.id,
        content: text,
        image_url: imagePath,
        video_url: videoPath,
        video_seconds: videoPath ? (clipSeconds ?? POST_VIDEO_MAX_SECONDS) : null,
        is_announcement: isAdmin ? announcement : false,
      });
      if (error) throw error;
      setContent("");
      clearFile();
      setAnnouncement(false);
      toast.success("Posted");
      onPosted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not publish that post");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex gap-3">
        <UserAvatar
          path={profile?.avatar_url}
          name={profile?.full_name ?? "You"}
          className="size-10"
        />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Share something with campus…"
          maxLength={1000}
          rows={3}
          aria-label="Post content"
          className="resize-none"
        />
      </div>

      {file && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
          <span className="truncate">
            {file.name}
            {kind === "video" && clipSeconds ? ` · ${clipSeconds}s` : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto min-h-11"
            onClick={clearFile}
            aria-label="Remove attachment"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {preparing && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {preparingKind === "video" ? "Checking video limits…" : "Compressing image…"}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          htmlFor="cmp-img"
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-sm text-muted-foreground hover:bg-secondary"
        >
          <ImageIcon className="size-4" aria-hidden="true" /> Photo
        </label>
        <input
          id="cmp-img"
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={preparing}
          onChange={(e) => {
            const selected = e.currentTarget.files?.[0] ?? null;
            e.currentTarget.value = "";
            void pick(selected, "image");
          }}
        />
        <label
          htmlFor="cmp-vid"
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-sm text-muted-foreground hover:bg-secondary"
        >
          <Video className="size-4" aria-hidden="true" /> Video
        </label>
        <input
          id="cmp-vid"
          type="file"
          accept="video/*"
          className="sr-only"
          disabled={preparing}
          onChange={(e) => {
            const selected = e.currentTarget.files?.[0] ?? null;
            e.currentTarget.value = "";
            void pick(selected, "video");
          }}
        />

        {isAdmin && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Switch
              checked={announcement}
              onCheckedChange={setAnnouncement}
              aria-label="Post as announcement"
            />
            Announcement
          </label>
        )}

        <Button
          onClick={submit}
          disabled={busy || preparing || atLimit}
          className="ml-auto min-h-11 px-6"
        >
          {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
          Post
        </Button>
      </div>
      <Label className="sr-only">Composer</Label>
    </section>
  );
}
