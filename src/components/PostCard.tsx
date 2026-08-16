import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Heart, MessageCircle, MessageSquare, Send, Trash2, Flag, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { StoredImage, StoredVideo, UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { timeAgo, sanitizeText } from "@/lib/campus";
import { getOrCreateConversation, type MiniProfile } from "@/lib/campus-data";

export interface PostRow {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  video_url: string | null;
  is_announcement: boolean;
  created_at: string;
}

interface Comment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export function PostCard({
  post,
  author,
  onDeleted,
}: {
  post: PostRow;
  author: MiniProfile | undefined;
  onDeleted: (id: string) => void;
}) {
  const { user, isAdmin, profile } = useCampus();
  const navigate = useNavigate();
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentAuthors, setCommentAuthors] = useState<Record<string, MiniProfile>>({});
  const [draft, setDraft] = useState("");

  const mine = user?.id === post.user_id;

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ count }, { data: mineLike }] = await Promise.all([
        supabase
          .from("post_likes")
          .select("id", { count: "exact", head: true })
          .eq("post_id", post.id),
        supabase
          .from("post_likes")
          .select("id")
          .eq("post_id", post.id)
          .eq("user_id", user?.id ?? "")
          .maybeSingle(),
      ]);
      if (!active) return;
      setLikes(count ?? 0);
      setLiked(Boolean(mineLike));
    })();
    return () => {
      active = false;
    };
  }, [post.id, user?.id]);

  const toggleLike = async () => {
    if (!user) return;
    if (liked) {
      setLiked(false);
      setLikes((n) => Math.max(0, n - 1));
      await supabase.from("post_likes").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      setLiked(true);
      setLikes((n) => n + 1);
      const { error } = await supabase
        .from("post_likes")
        .insert({ post_id: post.id, user_id: user.id });
      if (error) {
        setLiked(false);
        setLikes((n) => Math.max(0, n - 1));
      }
    }
  };

  const loadComments = async () => {
    const { data } = await supabase
      .from("post_comments")
      .select("id, user_id, content, created_at")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as Comment[];
    setComments(rows);
    const { fetchProfiles } = await import("@/lib/campus-data");
    setCommentAuthors(await fetchProfiles(rows.map((r) => r.user_id)));
  };

  const openComments = async () => {
    setShowComments((v) => !v);
    if (!showComments) await loadComments();
  };

  const addComment = async () => {
    const text = sanitizeText(draft, 500);
    if (!text || !user) return;
    const { error } = await supabase
      .from("post_comments")
      .insert({ post_id: post.id, user_id: user.id, content: text });
    if (error) {
      toast.error(profile?.is_banned ? "Your account is restricted" : error.message);
      return;
    }
    setDraft("");
    await loadComments();
  };

  const message = async () => {
    if (!user || mine) return;
    try {
      const id = await getOrCreateConversation(user.id, post.user_id);
      void navigate({ to: "/messages", search: { c: id } });
    } catch {
      toast.error("Could not open that chat");
    }
  };

  const remove = async () => {
    const { error } = await supabase.from("posts").delete().eq("id", post.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Post deleted");
      onDeleted(post.id);
    }
  };

  const report = async () => {
    if (!user) return;
    await supabase.from("reports").insert({
      reporter_id: user.id,
      target_type: "post",
      target_id: post.id,
      reason: "Reported from feed",
    });
    toast.success("Reported to the admin team");
  };

  const name = author?.full_name || "Student";

  return (
    <article
      className={`rounded-2xl border bg-card p-4 ${post.is_announcement ? "border-accent/50 bg-accent/5" : "border-border"}`}
    >
      <div className="flex items-center gap-3">
        <Link to="/u/$id" params={{ id: post.user_id }} aria-label={`View ${name}'s profile`}>
          <UserAvatar path={author?.avatar_url} name={name} className="size-10" />
        </Link>
        <div className="min-w-0">
          <Link to="/u/$id" params={{ id: post.user_id }} className="block">
            <p className="truncate text-sm font-semibold hover:underline">{name}</p>
          </Link>
          <p className="text-xs text-muted-foreground">
            {author ? `Year ${author.year_of_study} · ${author.major || "Student"} · ` : ""}
            {timeAgo(post.created_at)}
          </p>
        </div>
        {post.is_announcement && (
          <Badge className="ml-auto bg-accent text-accent-foreground">
            <Megaphone className="mr-1 size-3" aria-hidden="true" /> Announcement
          </Badge>
        )}
      </div>


      {post.content && <p className="mt-3 whitespace-pre-wrap text-sm">{post.content}</p>}
      {post.image_url && (
        <StoredImage
          path={post.image_url}
          alt="Post attachment"
          className="mt-3 max-h-96 w-full rounded-xl object-cover"
        />
      )}
      {post.video_url && <StoredVideo path={post.video_url} className="mt-3 w-full rounded-xl" />}

      <div className="mt-4 flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" className="min-h-11" onClick={toggleLike}>
          <Heart
            className={`mr-1 size-4 ${liked ? "fill-primary text-primary" : ""}`}
            aria-hidden="true"
          />
          {likes}
        </Button>
        <Button variant="ghost" size="sm" className="min-h-11" onClick={openComments}>
          <MessageSquare className="mr-1 size-4" aria-hidden="true" />
          Comment
        </Button>
        {!mine && (
          <Button variant="ghost" size="sm" className="min-h-11" onClick={message}>
            <MessageCircle className="mr-1 size-4" aria-hidden="true" />
            Message
          </Button>
        )}
        <div className="ml-auto flex items-center">
          {!mine && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 text-muted-foreground"
              onClick={report}
              aria-label="Report post"
            >
              <Flag className="size-4" aria-hidden="true" />
            </Button>
          )}
          {(mine || isAdmin) && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 text-destructive"
              onClick={remove}
              aria-label="Delete post"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {showComments && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-2">
              <UserAvatar
                path={commentAuthors[c.user_id]?.avatar_url}
                name={commentAuthors[c.user_id]?.full_name ?? "Student"}
                className="size-8"
              />
              <div className="rounded-xl bg-secondary px-3 py-2">
                <p className="text-xs font-semibold">
                  {commentAuthors[c.user_id]?.full_name ?? "Student"}
                </p>
                <p className="text-sm">{c.content}</p>
              </div>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          )}
          <div className="flex gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a comment…"
              rows={1}
              maxLength={500}
              aria-label="Write a comment"
              className="min-h-11 resize-none"
            />
            <Button onClick={addComment} className="min-h-11" aria-label="Send comment">
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

export function usePostAuthors(posts: PostRow[]) {
  const ids = useMemo(() => posts.map((p) => p.user_id), [posts]);
  const [authors, setAuthors] = useState<Record<string, MiniProfile>>({});
  useEffect(() => {
    if (ids.length === 0) return;
    let active = true;
    void import("@/lib/campus-data").then(async ({ fetchProfiles }) => {
      const map = await fetchProfiles(ids);
      if (active) setAuthors(map);
    });
    return () => {
      active = false;
    };
  }, [ids.join(",")]);
  return authors;
}
