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
        const expected =
          (setting?.value as { token?: string } | null)?.token ?? "";
        if (!expected || token.length !== expected.length || token !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: expired, error } = await supabaseAdmin
          .from("posts")
          .select("id, image_url, video_url")
          .lt("created_at", cutoff);
        if (error) return new Response(error.message, { status: 500 });

        const rows = expired ?? [];
        if (rows.length === 0) return Response.json({ removed: 0 });

        const paths = rows
          .flatMap((p) => [p.image_url, p.video_url])
          .filter((p): p is string => Boolean(p));
        if (paths.length > 0) await supabaseAdmin.storage.from("media").remove(paths);

        const { error: delError } = await supabaseAdmin
          .from("posts")
          .delete()
          .in(
            "id",
            rows.map((p) => p.id),
          );
        if (delError) return new Response(delError.message, { status: 500 });

        return Response.json({ removed: rows.length, files: paths.length });
      },
    },
  },
});
