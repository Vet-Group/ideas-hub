# Ideas Hub

Internal web app for seller research. A worker crawls trend sources on a schedule, Ideas Hub organizes
what it finds, and every morning it publishes a trend briefing with AI suggestions for ideas and keywords.
Store staff save the ideas they want to their store's list.

Status: phase 1 Step 2 (skeleton, schema and core rules) is in. Phase 1 is specified in
[docs/specs/phase-1.md](docs/specs/phase-1.md) and planned in
[docs/plans/ideas-hub-phase-1.md](docs/plans/ideas-hub-phase-1.md); the stack is
[ADR 0001](docs/adr/0001-stack.md) and the data model [ADR 0002](docs/adr/0002-data-model.md).

## Development

Node 24 and pnpm 12. `cp .env.example .env`, then `pnpm install`, `docker compose up -d --wait`
(Postgres on 5433, MinIO on 9300/9301) and `pnpm db:migrate`. Checks:
`pnpm -r typecheck && pnpm -r lint && pnpm -r test`.

## Phase 1 scope

- **Collection**: Facebook Ad Library through its web UI (real browser, logged out), on a schedule with
  rate limits and block handling, plus a few RSS news feeds and a US holiday table. One adapter per
  source. No Toidispy crawling: its terms forbid it.
- **Data**: research data (ads, shops, keywords, runs, news, briefings) is shared by all users. Saved
  ideas, tracked keywords and per-keyword briefings belong to a store.
- **Trend briefing**: one daily briefing and one report per keyword. Trending ads, rising ads, hot
  keywords, rising shops, news and holidays, and AI suggestions that link to their evidence. Shown in
  the app and posted to Lark.
- **Accounts and stores**: admins, and store staff with per-store permissions (`view`, `save`,
  `keywords`). Ideas can be saved from an ad, from a suggestion or by hand, and move through
  New → Picked → Done or Dropped.

Research behind these choices: [docs/research/2026-10-19-sources-and-crawlers.md](docs/research/2026-10-19-sources-and-crawlers.md).

## Later phases

Etsy Open API and Google Trends sources; pushing saved ideas to POD Studio; sign-in through the VET ERP's
Keycloak SSO with store scope; a read API for other apps.

## Boundaries

- Ideas Hub is a standalone app and shares no code with POD Studio or the VET ERP. It talks to them only
  through versioned HTTP contracts under `docs/contracts/`, so each app keeps its own release cycle.
- **Phase 1 only:** Ideas Hub has its own database and shares none with POD Studio or the VET ERP.
  Whether a later phase shares data at the database level is open and needs a new ADR.
- Phase 1 already stores the cross-app keys (user email, `erp_store_code`, `pod_studio_store_id`) so
  that the later integration needs no data migration.
