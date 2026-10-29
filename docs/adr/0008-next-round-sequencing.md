# ADR 0008: Sequencing the next round during the pilot

Status: accepted (2026-10-29), from the next-round plan (consensus of planner, architect and critic).
Deciders: owner (deep interview of 2026-10-29: "build everything now").
Inputs: prior-art survey of 8 ad-spy and market-research repos, the 14-day pilot (#55, verdict
2026-11-06 02:00 Asia/Ho_Chi_Minh), ADR 0006 (merge to `main` deploys).

## Context

The owner chose to build the next round now (idea status funnel, shop watchlist, product pages and
duration tiers, CSV export, platform and format filters, new news feeds, ad angle tagging, next-slot retry,
low-yield keywords, #100, Etsy) while the pilot still measures. AC 3 has no late day left (day 1 failed), AC 1
and AC 6 count until 2026-11-06 00:00, and every merge to `main` stops the worker and restarts the stack, with
a dump restore if a migration fails.

## Decision

- Ship the round as small PRs, all built now and merged by date:
  - **Before the verdict:** only web, docs and schema PRs that cannot change AC 1, 3 or 6. One merge a day,
    09:00–11:30, watched until health is green. A migration merges only after it has been applied to a
    restored copy of the latest dump.
  - **2026-11-05, after the last pilot briefing is posted:** the news-feed PR.
  - **From 2026-11-06 07:30:** scheduler, crawler, shared-score and briefing-page PRs (angle tagging,
    next-slot retry, low-yield keywords, the briefing's followed-shops box, #100, Etsy, title phrases).
- Angle tagging shares the owner's single daily AI cap: one `spentToday` sums briefings and angles and is
  used by both, and angles spend only after the day's briefing builds end.
- Non-shop domains are filtered on `/ads` through a flag set only by the `/ads` page, so the shop page and
  the keyword report keep their data.

## Drivers

- AC 3 has zero margin; AC 1 and AC 6 count until 2026-11-06 00:00.
- Merge equals deploy, with a dump-restore rollback.
- Owner lead times: Etsy review takes weeks; #100's remedy needs data.

## Alternatives considered

- **Ship each PR when ready, guarded only in code.** Rejected: one guard bug fails the pilot.
- **One integration branch.** Rejected: it breaks per-PR CI and widens a rollback.
- **A separate AI cap for angles.** Rejected: a new setting, and spend outside the owner's single cap.
- **Filter non-shop domains inside `listAds`.** Rejected: it would also change the shop page and the
  keyword report.

## Consequences

- The pilot guards are dates, not code properties. The cost is about a week's delay for angle tagging, the
  briefing box and Etsy (whose key is weeks away anyway).
- On busy days angle tagging gets only the cap's leftover; `reserveCall` also counts angle spend.
- Branches queued for 2026-11-06 need rebases and regenerated migrations.

## Follow-ups

- A Lark line for followed shops (not now, owner 2026-10-29).
- Etsy switches on when the Personal App is approved (`docs/ops/etsy-app.md`).
- Proxies only if AC 1 stays under 0.95 for 2 weeks after the next-slot retry.
- POD Studio push and Keycloak sign-in stay deferred.
