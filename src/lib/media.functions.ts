import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Delete a post together with any picture or video it carries, so nothing is
 * left behind in storage.
 */
export const deletePostWithMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ postId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: post, error } = await context.supabase
      .from("posts")
      .select("id, user_id, image_url, video_url")
      .eq("id", data.postId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!post) return { ok: true };

    if (post.user_id !== context.userId) {
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("You can only delete your own posts");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const paths = [post.image_url, post.video_url].filter(Boolean) as string[];
    if (paths.length > 0) await supabaseAdmin.storage.from("media").remove(paths);
    const { error: delError } = await supabaseAdmin.from("posts").delete().eq("id", post.id);
    if (delError) throw new Error(delError.message);
    return { ok: true };
  });

/** Delete a poll (admins only) and remove its picture from storage. */
export const deletePollWithMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ pollId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Admins only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: poll } = await supabaseAdmin
      .from("polls")
      .select("id, image_url")
      .eq("id", data.pollId)
      .maybeSingle();
    if (!poll) return { ok: true };
    if (poll.image_url) await supabaseAdmin.storage.from("media").remove([poll.image_url]);
    const { error } = await supabaseAdmin.from("polls").delete().eq("id", poll.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
