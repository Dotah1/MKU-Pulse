# MKU Pulse R2 media

## Decision

Use Cloudflare R2 as an optional private media store while retaining Supabase as the source of truth for authentication, metadata, RLS, and existing media. When `VITE_R2_MEDIA_WORKER_URL` is configured, new uploads use the Worker-backed R2 path; when blank, new uploads use Supabase Storage. The same URL setting is used by browser and server code.

## Implementation

- Cloudflare R2 bucket: `mku-pulse-media`, private, Standard storage, WEUR location.
- Cloudflare Worker gateway authenticates user requests with Supabase access tokens, writes uploads to R2, issues short-lived HMAC-signed media URLs, and handles user-authorized object deletion.
- R2 paths are marked with an `r2:` prefix in existing media URL columns. Legacy paths retain their existing format and continue using Supabase Storage.
- Upload failures fall back to Supabase Storage so publishing and profile updates remain available during rollout.
- Manual deletion removes R2 objects through the Worker and legacy objects through Supabase Storage.
- Scheduled post cleanup removes both R2 and Supabase Storage objects before deleting expired post rows. The internal Worker cleanup route is authenticated with a dedicated server-only `R2_MEDIA_CLEANUP_SECRET`; configure the same randomly generated secret in Vercel and the Worker binding.
- No database schema change is required.

## Project structure

- `src/lib/storage.ts`: client media upload, signed URL resolution, caching, and R2/Supabase fallback.
- `src/lib/media.functions.ts`: authenticated server-side media deletion for posts and polls.
- `src/routes/api/public/purge-expired-posts.ts`: authenticated scheduled cleanup of old posts and attached media.
- `infra/cloudflare/mku-pulse-media-worker.ts`: deployable Cloudflare Worker gateway source.
- `.env.example`: environment variable names and setup guidance.

## Constraints

- Do not make the R2 bucket public.
- Do not migrate or delete existing Supabase objects automatically.
- Keep R2 optional unless `VITE_R2_MEDIA_WORKER_URL` is configured.
- Keep the cleanup credential server-only; never expose it as a `VITE_` variable.
- Preserve existing TWA, authentication, RLS, and media behavior.
