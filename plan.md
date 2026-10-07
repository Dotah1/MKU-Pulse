# MKU Pulse R2 media migration

## Decision

Use Cloudflare R2 as a private media store while retaining Supabase as the source of truth for authentication, metadata, RLS, and existing media. New uploads use R2 when the configured media gateway is available; existing Supabase paths remain readable through the current signed-URL path.

## Implementation approach

- Cloudflare R2 bucket: `mku-pulse-media`, private, Standard storage, WEUR location.
- Cloudflare Worker gateway: authenticates requests with the existing Supabase access token, writes to the R2 bucket, issues short-lived HMAC-signed media URLs, and deletes R2 objects.
- R2 paths are marked with an `r2:` prefix in existing media URL columns. Legacy paths retain their current format and continue using Supabase Storage.
- Upload failures fall back to Supabase Storage so publishing and profile updates remain available during rollout.
- Delete handlers remove R2 objects through the gateway and continue removing legacy objects through Supabase Storage.
- No database schema change is required.

## Project structure

- `src/lib/storage.ts`: client media upload, signed URL resolution, caching, and R2/Supabase fallback.
- `src/lib/media.functions.ts`: authenticated server-side media deletion for posts and polls.
- `infra/cloudflare/mku-pulse-media-worker.ts`: deployable Cloudflare Worker gateway source.
- `.env.example`: public and server-side gateway URL configuration.

## Constraints

- Do not make the R2 bucket public.
- Do not migrate or delete existing Supabase objects automatically.
- Keep R2 optional until the Vercel environment variable is configured and the Worker health check passes.
- Preserve existing TWA, authentication, RLS, and media behavior.
