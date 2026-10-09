# MKU Pulse

MKU Pulse is a campus community app for Mount Kenya University students. It includes a campus feed, student connections, messaging, mentorship, notifications, polls, and moderation tools. The web app is also installable as a PWA and is wrapped as an Android Trusted Web Activity.

**Live app:** <https://mku-pulse.vercel.app>

The project is linked to GitHub and deploys through Vercel. Lovable has also been used as an editing workflow; changes made there synchronize to this repository.

## Local development

Use Node.js 22 (the project supports `>=22.12.0 <23`) and Bun, which uses the committed `bun.lock` file.

```sh
git clone https://github.com/Dotah1/MKU-Pulse.git
cd MKU-Pulse
bun install --frozen-lockfile
bun run dev
```

Useful checks:

```sh
bun run build
bun run lint
```

## Services

- **Supabase** provides authentication, Postgres, row-level security, realtime, and legacy media storage. Database changes are tracked under `supabase/migrations/`.
- **Cloudflare R2** stores newer media through the Worker source at `infra/cloudflare/mku-pulse-media-worker.ts`. Set `VITE_R2_MEDIA_WORKER_URL` in local/server environments to enable it; leave blank to use Supabase Storage for new media.
- **Scheduled post cleanup** runs through Vercel Cron. It uses the `PURGE_EXPIRED_POSTS_SECRET` or `CRON_SECRET` and deletes expired post media from Supabase Storage and R2. R2 cleanup additionally requires a server-only `R2_MEDIA_CLEANUP_SECRET` in Vercel and the matching secret binding on the Cloudflare Worker.

Copy `.env.example` as a reference for local environment variables. Never commit real credentials or secret values. The Android wrapper is in `twa/`; its host and asset links must stay aligned with the live app domain.
