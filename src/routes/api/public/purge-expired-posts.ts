import { createFileRoute } from "@tanstack/react-router";

function constantTimeEqual(received: string, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Removes posts older than 24 hours along with the pictures and videos they
 * carry. Called by Vercel Cron or a private scheduler.
 */
async function purgeExpiredPosts(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const suppliedToken = bearerToken || request.headers.get("x-purge-token") || "";
  const expectedToken =
    process.env["PURGE_EXPIRED_POSTS_SECRET"] || process.env["CRON_SECRET"] || "";

  if (!expectedToken) {
    console.error(
      "Purge endpoint is not configured with PURGE_EXPIRED_POSTS_SECRET or CRON_SECRET",
    );
    return new Response("Purge endpoint is not configured", { status: 503 });
  }
  if (!constantTimeEqual(suppliedToken, expectedToken)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const batchSize = 100;
  const maxBatches = 10;
  let removed = 0;
  let files = 0;
  let batches = 0;

  try {
    while (batches < maxBatches) {
      const { data: expired, error } = await supabaseAdmin
        .from("posts")
        .select("id, image_url, video_url")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(batchSize);
      if (error) throw error;

      const rows = expired ?? [];
      if (rows.length === 0) break;

      const paths = rows
        .flatMap((post) => [post.image_url, post.video_url])
        .filter((path): path is string => Boolean(path));
      const r2Paths = paths.filter((path) => path.startsWith("r2:"));
      const supabasePaths = paths.filter((path) => !path.startsWith("r2:"));

      if (r2Paths.length > 0) {
        const workerUrl = process.env["VITE_R2_MEDIA_WORKER_URL"]?.replace(/\/$/, "");
        const cleanupSecret = process.env["R2_MEDIA_CLEANUP_SECRET"];
        if (!workerUrl || !cleanupSecret) {
          throw new Error("R2 media cleanup is not configured");
        }
        const response = await fetch(`${workerUrl}/internal/delete-media`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cleanupSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ paths: r2Paths }),
        });
        if (!response.ok) throw new Error("Could not delete R2 media");
      }

      if (supabasePaths.length > 0) {
        const { error: storageError } = await supabaseAdmin.storage
          .from("media")
          .remove(supabasePaths);
        if (storageError) throw storageError;
      }

      const { error: deleteError } = await supabaseAdmin
        .from("posts")
        .delete()
        .in(
          "id",
          rows.map((post) => post.id),
        );
      if (deleteError) throw deleteError;

      removed += rows.length;
      files += paths.length;
      batches += 1;
      if (rows.length < batchSize) break;
    }

    let hasMore = false;
    if (batches === maxBatches) {
      const { data: remaining, error } = await supabaseAdmin
        .from("posts")
        .select("id")
        .lt("created_at", cutoff)
        .limit(1);
      if (error) throw error;
      hasMore = Boolean(remaining?.length);
    }

    return Response.json({ removed, files, hasMore });
  } catch (error) {
    console.error("Could not purge expired posts", error);
    return Response.json({ error: "Could not complete post cleanup" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/purge-expired-posts")({
  server: {
    handlers: {
      GET: ({ request }) => purgeExpiredPosts(request),
      POST: ({ request }) => purgeExpiredPosts(request),
    },
  },
});
