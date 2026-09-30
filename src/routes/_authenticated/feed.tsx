import { useEffect, useState } from "react";
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
import { POST_MEDIA_MAX_BYTES, POST_VIDEO_MAX_SECONDS, sanitizeText } from "@/lib/campus";
import { uploadFile, videoDuration } from "@/lib/storage";
import { countToday } from "@/lib/campus-data";

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
  const authors = usePostAuthors(posts);

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
      <header>
        <h1 className="font-display text-2xl font-bold">Campus feed</h1>
        <p className="text-sm text-muted-foreground">
          {tier === "free"
            ? `${limits.postsPerDay - usedToday} of ${limits.postsPerDay} text posts left today · upgrade for photos & video`
            : `${Math.max(0, limits.postsPerDay - usedToday)} posts left today on your ${limits.label} plan`}
        </p>
      </header>

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
      ) : (
        <div className="space-y-4">
          {posts.map((p) => (
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

  const atLimit = usedToday >= limits.postsPerDay;

  const pick = async (f: File | null, want: "image" | "video") => {
    if (!f) return;
    if (want === "image" && !limits.canPostImage) {
      toast.error("Photo posts need the Mid or Full plan");
      return;
    }
    if (want === "video" && !limits.canPostVideo) {
      toast.error("Video posts need the Full plan");
      return;
    }
    if (f.size > POST_MEDIA_MAX_BYTES) {
      toast.error("Files must be under 25MB");
      return;
    }
    let seconds: number | null = null;
    if (want === "video") {
      try {
        const d = await videoDuration(f);
        seconds = Math.min(Math.round(d), POST_VIDEO_MAX_SECONDS);
        if (d > POST_VIDEO_MAX_SECONDS) {
          toast.warning(
            `That clip is ${Math.round(d)} seconds long — only the first ${POST_VIDEO_MAX_SECONDS} seconds will be posted.`,
          );
        }
      } catch {
        toast.error("Could not read that video");
        return;
      }
    }
    setFile(f);
    setKind(want);
    setClipSeconds(seconds);
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
        const path = await uploadFile("media", user.id, file);
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
            {kind === "video" && clipSeconds ? ` · first ${clipSeconds}s` : ""}
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
          onChange={(e) => void pick(e.target.files?.[0] ?? null, "image")}
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
          onChange={(e) => void pick(e.target.files?.[0] ?? null, "video")}
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

        <Button onClick={submit} disabled={busy || atLimit} className="ml-auto min-h-11 px-6">
          {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
          Post
        </Button>
      </div>
      <Label className="sr-only">Composer</Label>
    </section>
  );
}
