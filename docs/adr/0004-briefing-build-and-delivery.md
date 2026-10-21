# ADR 0004: Briefing build, AI sections and Lark delivery

Status: accepted for phase 1 (2026-10-20); the feed list, the price table and the Lark credentials wait
for the owner (see "Open").
Inputs: spec §1 "Sources", §2, §3 "Trend briefing" and "Delivery", plan Steps 3 and 7, ADR 0001 (stack).

## Context

Each morning the worker builds the global briefing and one report per tracked keyword from the last
completed scheduled run, adds an AI summary and AI suggestions, and posts a summary to Lark. The plan
fixes the rules (at most 2 LLM calls per briefing, cost committed before each call, idempotent sections,
`uuid`-deduplicated posts); this ADR records how they are built and the choices the plan left open.

## Decision

- **Stored shape.** `briefings.sections` follows `packages/core/src/briefing/sections.ts`, one key per
  section, merged with `new || stored` so a stored key is never overwritten. Sections 5 and 6 are stored
  together with the `suggestions` rows in one transaction. `ready_at` and the `lark.send` jobs of the
  briefing are written in one transaction.
- **Which briefings.** The global one, and one per keyword that is active and tracked by at least one
  store (`store_keywords`): the plan's "store-tracked keywords until the cap". A seed keyword no store
  tracks has its live keyword report page (Step 6) but no stored briefing. A keyword briefing has the
  same sections filtered to its keyword (section 4: shops with ads seen under it, with their overall
  counts), the global news list, and its own AI call. Its KPI row is the source run's.
- **Scheduling.** The scheduler's minute pass sends the builds of the next build time not yet reached
  (`singletonKey` `${date}:global` / `${date}:kw:${id}`, global at priority 10, keywords 0, all in one
  transaction), and re-sends a queued build whose start no longer matches the build time (later or still
  ahead: the new time; moved into the past: now). Crash recovery re-sends today's briefing rows without
  `ready_at` once the build time has passed. The handler inserts its briefing row first, so the window in
  which a cancelled job has no row is the settings read only; the watchdog's `briefing_late` covers it.
- **RSS refresh.** No separate job: the global `briefing.build` refreshes the enabled feeds right before
  section 5 (15 s per feed, all in parallel, each failing on its own), so feeds get one request a day and
  news is fresh at 06:30. Items keep title, link, date and the feed's own summary clipped to 500
  characters; `content:encoded` is never read. The section uses items of the last 72 h, newest 15.
- **Seed data.** `pnpm db:seed` loads the US holidays (`packages/db/seed/holidays-us.json`, 2026–2027)
  and the default feeds (`news-feeds.json`), idempotently, besides the seed keywords; no data migration,
  so the JSON files are the one source. A deleted row comes back on the next seed; admins disable feeds.
- **LLM call.** `openai` 7.30.0 chat completions against `LLM_BASE_URL` with `maxRetries: 0`, so every
  attempt is one counted call; no `response_format` (not every OpenAI-compatible route supports it), the
  reply is parsed from its first `{` to its last `}`. Each call is raced against the LLM timeout and the
  job's `signal`. A reply that fails the zod schema, or cites an id that was not in the prompt, gets the
  one retry with the problem stated; after it, suggestions with bad refs are dropped (if only the refs
  were wrong). The state of sections 5 and 6 is `skipped: cost_cap` when the cap refused the first call
  of the build, else `failed: ai` when no valid reply came.
- **Cost.** Estimate = prompt characters ÷ 3 × input price + `max_tokens` (4000) × output price, from
  `MODEL_PRICES` in `packages/core/src/briefing/cost.ts` (an unknown model is priced high). The estimate,
  an upper bound, is what `ai_cost_usd` records; the check sums all briefings of the day under an
  advisory lock.
- **Lark.** A text message (title, 3 key points from the KPI, the top keyword, the top rising shop or the
  next holiday, the top 5 ads, the AI summary when there is one, and the link to `APP_URL`). The bot's
  Open API origin is `LARK_BASE_URL`; the shared group and the admin chat are `LARK_SHARED_CHAT_ID` and
  `LARK_ADMIN_CHAT_ID` (environment, not settings); store chats are `stores.lark_chat_id`. Without the
  app id and secret nothing is posted. The watchdog gets the Lark sender for Alerts and checks the global
  briefing (`briefing_late`, `lark_send_failed`) once today's ready time has passed.
- **Lark custom-bot webhook (temporary).** While the app id and secret are empty and `LARK_WEBHOOK_URL`
  is set, every post (global briefing, store briefings, Alerts) goes to that group's custom bot as the
  same text message, signed with `timestamp` and `sign` when `LARK_WEBHOOK_SECRET` is set; a reply with
  `code` other than 0 is a failed post, retried by `lark.send`. Posts are recorded under the chat
  `webhook`, and since a custom bot returns no message id, the stored id is `webhook:<uuid>`, so the row
  written before the post, the watchdog's checks and AC 1 and AC 3 work unchanged. Lark does **not**
  dedupe webhook posts (the `uuid` is only ours): a worker that dies between Lark's answer and the row
  update posts once more on the retry. Each process keeps to the custom bot's 5 posts a second and 100 a
  minute. Back to the bot app: set the app id, secret and chat ids and restart the worker
  (`docs/ops/lark-and-llm.md`); the app wins whenever its id and secret are set.
- **Ready margin.** Settings are rejected when the ready time is before the build time plus the briefing
  job expiry plus `briefingReadyMarginSeconds` (`packages/core/src/validate-settings.ts`): one 2 s queue
  pickup for the build, then 4 `lark.send` attempts (first + `LARK_RETRY_LIMIT` 3) of a 2 s pickup plus
  the Lark send timeout each, and 3 retry delays of 30 s; 220 s with the defaults (06:30 + 900 s +
  220 s = 06:48:40, before 07:00). No setting of its own.
- **Alert cut-off.** The watchdog sends only unsent Alerts created in the last 24 h
  (`ALERT_MAX_AGE_MS` in `apps/worker/src/watchdog-pass.ts`, next to the 60 s `ALERT_BUDGET_MS`).
  Before sending, it sets `alerts.lark_skipped_at` on every unsent Alert older than that, so a backlog
  written before Lark was configured, or an Alert Lark kept rejecting for a day, is never posted later;
  such Alerts keep `sent_at` and `lark_message_id` empty and stay on `/admin/alerts` (spec §3). A
  nullable column rather than a `sent_at` without a message id, so `sent_at` keeps meaning "posted".

## Consequences

- Tests use a fake LLM behind `LlmClient` and a fake Lark server on a random port; nothing in the repo
  calls a real model or the real Lark in tests. `pnpm briefing:build --fake-llm` builds a day's briefings
  locally with a canned reply.
- The estimate over-counts real spend, so fewer keyword briefings get AI sections than the cap would
  allow; replacing it with the provider's reported usage after the call would change only `cost.ts` and
  the reservation.

## Open

- Owner: review the feed list in `packages/db/seed/news-feeds.json`.
- Owner: check `MODEL_PRICES` against the provider's price for the configured model.
- Owner: the Lark bot app credentials and chat ids, then one real test post.

## Changelog

- 2026-10-21: added "Alert cut-off" (option B of the morning status question 2, with a 24 h cut-off).
  Decided by the owner's delegate on 2026-10-21, reversible: dropping the cut-off and clearing
  `lark_skipped_at` sends those Alerts again.
- 2026-10-21: added "Ready margin" (PR #24 "needs a product decision"). Decided by the owner's delegate
  on 2026-10-21, reversible: dropping `briefingReadyMarginSeconds` from the check restores the old rule.
- 2026-10-21: stored settings that fail validation write a `settings_invalid` Alert, one per local day,
  sent by the watchdog like any Alert. Decided by the owner's delegate on 2026-10-21, reversible.
- 2026-10-21: added "Lark custom-bot webhook (temporary)", used until the bot app's credentials exist.
  Decided by the owner's delegate on 2026-10-21, reversible: setting `LARK_APP_ID` and
  `LARK_APP_SECRET` switches back to the bot app, and removing `larkWebhookClient` removes the mode.
