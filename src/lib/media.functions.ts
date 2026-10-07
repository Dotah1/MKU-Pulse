import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function deleteMediaPaths(paths: string[]) {
  const legacyPaths = paths.filter((path) => !path.startsWith("r2:"));
  const r2Paths = paths.filter((path) => path.startsWith("r2:"));

  if (legacyPaths.length > 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage.from("media").remove(legacyPaths);
    if (error) throw new Error(`Could not delete Supabase media: ${error.message}`);
  }

  if (r2Paths.length > 0) {
    const workerUrl = process.env["R2_MEDIA_WORKER_URL"]?.replace(/\/$/, "");
    const authorization = getRequest()?.headers.get("authorization");
    if (!workerUrl || !authorization) throw new Error("R2 media cleanup is not configured");
    for (const path of r2Paths) {
      const response = await fetch(`${workerUrl}/media?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
        headers: { Authorization: authorization },
      });
      if (!response.ok) throw new Error("Could not delete R2 media");
    }
  }
}

/**
 * Delete a post together with any picture or video it carries, so nothing is
 * left behind in storage.
 */
export const deletePostWithMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ postId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: post, error } = await supabaseAdmin
      .from("posts")
      .select("id, user_id, image_url, video_url")
      .eq("id", data.postId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!post) return { ok: true };

    if (post.user_id !== context.userId) {
      const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (roleError) throw new Error(roleError.message);
      if (!isAdmin) throw new Error("You can only delete your own posts");
    }

    const paths = [post.image_url, post.video_url].filter(Boolean) as string[];
    if (paths.length > 0) await deleteMediaPaths(paths);
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
    const { data: poll, error: pollError } = await supabaseAdmin
      .from("polls")
      .select("id, image_url")
      .eq("id", data.pollId)
      .maybeSingle();
    if (pollError) throw new Error(pollError.message);
    if (!poll) return { ok: true };
    if (poll.image_url) await deleteMediaPaths([poll.image_url]);
    const { error } = await supabaseAdmin.from("polls").delete().eq("id", poll.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
