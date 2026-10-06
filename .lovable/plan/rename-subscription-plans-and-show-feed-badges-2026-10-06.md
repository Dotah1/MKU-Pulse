# Rename subscription plans and show feed badges

## Changes
- Rename the visible plan labels to Campus Citizen, Campus Socialite, and Campus VIP while preserving the existing internal tier values and limits.
- Update plan wording in profile, payments, admin pricing, public profiles, and upgrade messages.
- Display a compact subscription symbol and plan name beside every feed post author, using the author’s current saved tier.

## Technical details
- Keep database values `free`, `mid`, and `full` unchanged to avoid a migration and preserve existing subscriptions.
- Define the plan badge metadata centrally with the tier limits so all screens use consistent labels and symbols.
- Reuse the profile tier already fetched with feed author data; no additional request or database change is needed.
- Validate the app after editing and inspect the feed at mobile size.
