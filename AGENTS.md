<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Subscription display metadata belongs in `TIER_LIMITS`; internal tier keys remain stable so labels and symbols can change without data migrations.
- Blocking is enforced in the database (send/start-chat/swipe rules check `is_blocked_between`); the UI only hides blocked users, so never rely on client filtering alone.
- `profiles.mku_verified` can only be set by the server-only `mark_mku_verified` function; the verified MKU email lives in private `profile_contacts`.
