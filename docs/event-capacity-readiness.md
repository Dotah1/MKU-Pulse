# Event capacity readiness

Use this checklist before high-traffic campus events. It complements code-level optimizations; it does not replace testing against a realistic traffic profile.

## Before the event

1. Record the expected peak number of simultaneously active users, not only the monthly active-user target. Estimate how many will browse the feed, open chats, send messages, and upload media at the same time.
2. Confirm the actual Supabase and Vercel plans and current quotas. Plan limits can change; use the linked provider dashboards and current documentation rather than treating example values as permanent.
3. Capture a baseline for Realtime peak connections, Realtime messages per second and per billing period, Postgres database size, Supabase egress, and Vercel function usage. Compare each metric with the limit for the actual plan.
4. Set warning points at 70% of each relevant plan quota where the provider supports alerts. Include a named owner and a response action for each alert; a threshold without an owner is not operationally useful.
5. Run any load test against staging only. Agree on the traffic profile and test window first. Do not run load tests against production.

## During the event

- Watch Realtime connection peaks and errors such as `too_many_connections` and `tenant_events`.
- Watch database size, query latency, egress, and failed writes. Realtime socket pressure and database pressure are separate signals.
- Check Vercel function errors and resource usage, including scheduled cleanup runs.
- If a threshold is reached, reduce nonessential live updates or uploads before disabling core chat or changing retention behavior.

## Current implementation notes

- The browser uses one shared Supabase client per tab. Hidden tabs now disconnect that tab's Realtime socket after two minutes and reconnect when shown.
- The inbox-wide message listener is active only while the conversation list is shown. An open chat uses its conversation-filtered listener; the inbox refreshes when the user returns to it.
- Typing-state writes are throttled to one update per three seconds. The indicator expires if no refresh arrives.
- Feed posts still use a Realtime insert subscription. Do not replace it with polling without testing the request-versus-fanout tradeoff under the planned event profile.
- The post-expiry cleanup query has an additive `created_at` index migration. Apply migrations through the normal reviewed deployment process; this runbook does not apply them.
- Media remains behind the private signed Cloudflare Worker. Do not make the R2 bucket public or add a broad expiry lifecycle rule; current keys do not have a feed-only prefix.

## Provider references

- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Supabase usage quotas](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Supabase database size and read-only mode](https://supabase.com/docs/guides/platform/database-size)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
