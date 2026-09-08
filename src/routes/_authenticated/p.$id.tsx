import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PostCard, type PostRow } from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { fetchProfiles, type MiniProfile } from "@/lib/campus-data";

export const Route = createFileRoute("/_authenticated/p/$id")({
  head: () => ({
    meta: [
      { title: "Post — MKU Pulse" },
      { name: "description", content: "Open a single post from the MKU Pulse campus feed." },
      { property: "og:title", content: "Post — MKU Pulse" },
      { property: "og:description", content: "A post on the MKU Pulse campus feed." },
    ],
  }),
  component: SinglePostPage,
});

function SinglePostPage() {
  const { id } = Route.useParams();
  const [post, setPost] = useState<PostRow | null>(null);
  const [author, setAuthor] = useState<MiniProfile | undefined>();
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("posts")
        .select(
          "id, user_id, content, image_url, video_url, video_seconds, is_announcement, created_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      const row = (data as PostRow | null) ?? null;
      setPost(row);
      setLoading(false);
      if (row) {
        const map = await fetchProfiles([row.user_id]);
        if (active) setAuthor(map[row.user_id]);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" className="min-h-11">
        <Link to="/feed">
          <ArrowLeft className="mr-2 size-4" aria-hidden="true" /> Back to feed
        </Link>
      </Button>

      {loading ? (
        <Loader2 className="mx-auto my-12 size-6 animate-spin text-muted-foreground" />
      ) : !post || gone ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          This post is no longer available.
        </p>
      ) : (
        <PostCard post={post} author={author} onDeleted={() => setGone(true)} />
      )}
    </div>
  );
}
