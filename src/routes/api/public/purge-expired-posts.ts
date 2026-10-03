import { createFileRoute } from "@tanstack/react-router";

/**
 * Removes posts older than 24 hours along with the pictures and videos they
 * carry. Called on a schedule with a private token.
 */
export const Route = createFileRoute("/api/public/purge-expired-posts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-purge-token") ?? "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: setting } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", "post_purge_token")
          .maybeSingle();
        const expected = (setting?.value as { token?: string } | null)?.token ?? "";
        if (!expected || token.length !== expected.length || token !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const batchSize = 100;
        const maxBatches = 10;
        let removed = 0;
        let files = 0;
        let batches = 0;

        while (batches < maxBatches) {
          const { data: expired, error } = await supabaseAdmin
            .from("posts")
            .select("id, image_url, video_url")
            .lt("created_at", cutoff)
            .order("created_at", { ascending: true })
            .limit(batchSize);
          if (error) return Response.json({ error: error.message }, { status: 500 });

          const rows = expired ?? [];
          if (rows.length === 0) break;

          const paths = rows
            .flatMap((post) => [post.image_url, post.video_url])
            .filter((path): path is string => Boolean(path));
          if (paths.length > 0) {
            const { error: storageError } = await supabaseAdmin.storage.from("media").remove(paths);
            if (storageError) {
              return Response.json({ error: storageError.message }, { status: 500 });
            }
          }

          const { error: deleteError } = await supabaseAdmin
            .from("posts")
            .delete()
            .in(
              "id",
              rows.map((post) => post.id),
            );
          if (deleteError) return Response.json({ error: deleteError.message }, { status: 500 });

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
          if (error) return Response.json({ error: error.message }, { status: 500 });
          hasMore = Boolean(remaining?.length);
        }

        return Response.json({ removed, files, hasMore });
      },
    },
  },
});
