import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Heart,
  MessageCircle,
  MessageSquare,
  Reply,
  Send,
  Trash2,
  Flag,
  Megaphone,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/hooks/useCampus";
import { StoredImage, StoredVideo, UserAvatar } from "@/components/StoredMedia";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { timeAgo, sanitizeText } from "@/lib/campus";
import { deletePostWithMedia } from "@/lib/media.functions";
import { getOrCreateConversation, type MiniProfile } from "@/lib/campus-data";


export interface PostRow {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  video_url: string | null;
  video_seconds: number | null;
  is_announcement: boolean;
  created_at: string;
}

interface Comment {
  id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
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
  const [commentCount, setCommentCount] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentAuthors, setCommentAuthors] = useState<Record<string, MiniProfile>>({});
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [reported, setReported] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);

  const mine = user?.id === post.user_id;

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ count }, { data: mineLike }, { count: comments }, { data: myReport }] =
        await Promise.all([
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
          supabase
            .from("post_comments")
            .select("id", { count: "exact", head: true })
            .eq("post_id", post.id),
          supabase
            .from("reports")
            .select("id")
            .eq("target_type", "post")
            .eq("target_id", post.id)
            .eq("reporter_id", user?.id ?? "")
            .maybeSingle(),
        ]);
      if (!active) return;
      setLikes(count ?? 0);
      setLiked(Boolean(mineLike));
      setCommentCount(comments ?? 0);
      setReported(Boolean(myReport));
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
      .select("id, user_id, content, parent_id, created_at")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as Comment[];
    setComments(rows);
    setCommentCount(rows.length);
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
    const { error } = await supabase.from("post_comments").insert({
      post_id: post.id,
      user_id: user.id,
      content: text,
      parent_id: replyTo ? (replyTo.parent_id ?? replyTo.id) : null,
    });
    if (error) {
      toast.error(profile?.is_banned ? "Your account is restricted" : error.message);
      return;
    }
    setDraft("");
    setReplyTo(null);
    await loadComments();
  };

  const message = async () => {
    if (!user || mine) return;
    try {
      const id = await getOrCreateConversation(user.id, post.user_id);
      void navigate({ to: "/messages", search: { c: id, p: post.id } });
    } catch {
      toast.error("Could not open that chat");
    }
  };

  const remove = async () => {
    try {
      await deletePostWithMedia({ data: { postId: post.id } });
      toast.success("Post deleted");
      onDeleted(post.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete that post");
    }
  };


  const submitReport = async () => {
    if (!user) return;
    const reason = sanitizeText(reportReason, 500);
    if (reason.length < 4) {
      toast.error("Please say why you're reporting this post");
      return;
    }
    setReporting(true);
    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      target_type: "post",
      target_id: post.id,
      reason,
    });
    setReporting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReported(true);
    setReportOpen(false);
    setReportReason("");
    toast.success("Thanks — the admin team will look into it");
  };

  const name = author?.full_name || "Student";
  const threads = comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  const commentRow = (c: Comment, isReply: boolean) => (
    <div key={c.id} className={isReply ? "ml-10 flex gap-2" : "flex gap-2"}>
      <Link to="/u/$id" params={{ id: c.user_id }} aria-label="View profile" className="shrink-0">
        <UserAvatar
          path={commentAuthors[c.user_id]?.avatar_url}
          name={commentAuthors[c.user_id]?.full_name ?? "Student"}
          className={isReply ? "size-7" : "size-8"}
        />
      </Link>
      <div className="min-w-0">
        <div className="rounded-xl bg-secondary px-3 py-2">
          <Link to="/u/$id" params={{ id: c.user_id }}>
            <p className="text-xs font-semibold hover:underline">
              {commentAuthors[c.user_id]?.full_name ?? "Student"}
            </p>
          </Link>
          <p className="text-sm">{c.content}</p>
        </div>
        <button
          type="button"
          onClick={() => setReplyTo(c)}
          className="mt-1 inline-flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-primary"
        >
          <Reply className="size-3" aria-hidden="true" /> Reply
        </button>
      </div>
    </div>
  );

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
      {post.video_url && (
        <StoredVideo
          path={post.video_url}
          maxSeconds={post.video_seconds}
          className="mt-3 w-full rounded-xl"
        />
      )}

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
          {commentCount} {commentCount === 1 ? "comment" : "comments"}
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
              className={`min-h-11 ${reported ? "text-destructive" : "text-muted-foreground"}`}
              onClick={() => (reported ? toast("You already reported this post") : setReportOpen(true))}
              aria-label={reported ? "Post reported" : "Report post"}
            >
              <Flag
                className={`size-4 ${reported ? "fill-destructive text-destructive" : ""}`}
                aria-hidden="true"
              />
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

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report this post</DialogTitle>
            <DialogDescription>
              Tell us what's wrong with it. Only the admin team sees this.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Reason for reporting…"
            aria-label="Reason for reporting"
          />
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button className="min-h-11" disabled={reporting} onClick={() => void submitReport()}>
              Submit report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showComments && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {threads.map((c) => (
            <div key={c.id} className="space-y-2">
              {commentRow(c, false)}
              {repliesOf(c.id).map((r) => commentRow(r, true))}
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          )}
          {replyTo && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              Replying to {commentAuthors[replyTo.user_id]?.full_name ?? "Student"}
              <button
                type="button"
                className="underline"
                onClick={() => setReplyTo(null)}
              >
                cancel
              </button>
            </p>
          )}
          <div className="flex gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
              rows={1}
              maxLength={500}
              aria-label={replyTo ? "Write a reply" : "Write a comment"}
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
