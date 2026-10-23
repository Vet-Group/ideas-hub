# Ideas Hub phase 3 plan (after the pilot)

Status: **started 2026-10-23.** The owner lifted the wait for the day-14 verdict on 2026-10-23 (see
"Pilot run" in `docs/ops/production.md`): items that need nobody outside this repo (1, 2) are built now,
while the pilot keeps measuring. Owner decisions of 2026-10-22 still hold otherwise: items that need another
owner get a draft only, which the owner takes to that owner.

## Order

The verdict's figures change the order only through the rules below; they apply to the items not built
before the verdict (3 onwards).

| # | Item | Needs | Why here |
|---|---|---|---|
| 1 | **Done** (#69, 2026-10-23). Change one's own password (spec below) | nobody | Staff accounts are created by an admin with a first password; no one can change it without the admin today. Small, in-app, no data migration |
| 2 | **Done** (#70, 2026-10-23). Screen for a store's tracked keywords for store staff with `keywords` permission | nobody | Today only admins edit them (`/admin/keywords`); the `keywords` permission exists but has no screen |
| 3 | **Done** (#72, #75, 2026-10-23: Cloudflare Worker `ideas-hub-heartbeat` on the owner's account). External heartbeat for a fully down host | owner: which account runs the probe (for example a Cloudflare Worker cron on the owner's account) | The watchdog runs on the host itself, so a dead host stays silent |
| 4 | **Done** (#73, 2026-10-23: R2 bucket `ideas-hub-backup`, first snapshot and drill ok, timers on). Off-host backup (ADR 0007, D3 reversed) | owner: bucket and key | Built 2026-10-23 (restic to Cloudflare R2, `docs/ops/production.md`); switched on when the bucket and key are installed |
| 5 | **Done** (#76, 2026-10-23). `/api/v1` read API (contract `ideas-hub-v1.md` §3) | the consumers agreeing the contract | Draft exists |
| 6 | Push a saved idea to POD Studio (contract §2) | POD Studio owner | Draft exists; review with the POD Studio owner first |
| 7 | Sign-in with the ERP's Keycloak (draft below) | ERP owner; the ERP repo and host are frozen | Draft questions below |
| 8 | Etsy Open API and Google Trends sources | owner: Etsy API key | New sources after the Ad Library is stable |
| 9 | **Not worth it now** (measured 2026-10-24). Stored WebP thumbnails | a size measurement | 8,631 objects, 1.39 GB (160 KB each on average) with 157 GB free on the host and a deduplicating off-host backup; WebP would save well under 1 GB. Measure again at 10 GB |
| 10 | Larger crawl scale (more browsers or IPs, a proxy) | owner: cost | Measured again after |

Rules from the verdict:

- A failed verdict: no further phase 3 items; the verdict's fix options come first.
- AC 1's `success_ratio` under 0.95 on a pass: item 10 moves to 3 (crawl headroom before new features).
- AC 3 with a late day on a pass: the briefing timing fix (verdict's AC 3 options) goes before item 2.
- The Trending sort on `/ads` was built before day 1 (#60, #61), so it is not on this list.

## Item 1: change one's own password

Goal: a signed-in user changes their own password on `/account`, and their other sessions end.

- Route `apps/web/src/app/(app)/account/page.tsx` (signed-in layout, like the other `(app)` pages): a form
  with current password, new password and the new password again; a link to it next to "Sign out" in the
  sidebar and the bottom tabs (`components/shell`).
- Server action `apps/web/src/app/(app)/account/actions.ts`: validate with zod (new password at least 8
  characters, as `admin/users/actions.ts`; both new fields equal; new differs from current), then
  `auth.api.changePassword({ body: { currentPassword, newPassword, revokeOtherSessions: true }, headers })`
  (better-auth 1.7.7). A wrong current password (`APIError`) returns a form error; it counts toward the
  same attempt limit as sign-in (`lib/login-limit.ts`, key `email:<email>`), so the form cannot be used to
  guess a password.
- Strings in `lib/strings.vi.ts` (Vietnamese UI), no new dependency, no schema change.
- Tests: unit tests of the action next to `login/actions.test.ts` (wrong current password, mismatch, too
  short, success revokes other sessions, attempt limit); one e2e case: change the password, sign out, sign
  in with the new one, the old one fails.
- Done when: the PR is merged with CI green on its head and deployed; `/account` answers 200 for a signed-in
  user on `ideas.vetgroup.net`.

## Draft: sign-in with the ERP's Keycloak (for the ERP owner)

Proposed, from Ideas Hub's side only (the ERP was not read):

- OpenID Connect authorization code flow with PKCE; Ideas Hub is a confidential client
  `ideas-hub` with redirect URI `https://ideas.vetgroup.net/api/auth/callback/keycloak`.
- Claims used: `email` (verified) matched lower-cased to `users.email`; group membership
  `store-<erp_store_code>` mapped to `stores.erp_store_code`; a role or group for Ideas Hub admins.
- Accounts: an unknown email is refused (no sign-up), or created as staff without stores (to decide).
  Password sign-in stays for the owner's admin account as a fallback.
- Questions for the ERP owner: the realm and issuer URL; whether groups are in the ID token; who creates
  the client; how a store's group is named; whether staff leave the ERP and must lose access the same day
  (session length).
