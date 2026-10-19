# ADR 0001: Technology stack

Status: proposed (2026-10-19)
Deciders: owner

## Context

Ideas Hub phase 1 ([spec](../specs/phase-1.md)) is a small internal web app with three moving parts: a
web UI with accounts and per-store permissions, a scheduled browser crawler for one site
(Facebook Ad Library, logged out) plus RSS feeds, and daily jobs that build a briefing, call one LLM and
post to Lark. It runs on one machine: the owner's Windows PC in development, the Linux desktop that
hosts POD Studio for internal production.

Neighbours, read-only (2026-10-19):

- **POD Studio**: Next.js 16 + React 19 + TypeScript, Postgres 16 + Drizzle, pg-boss, better-auth
  (email and password, admin plugin), MinIO, pnpm workspaces, Node `>=22.12` in its `package.json`;
  Python worker with Playwright for
  its own AI jobs. Stores have per-store permission ticks (ADR 0007/0009 there).
- **VET ERP**: Python 3.14, Frappe/ERPNext v16, MariaDB, Keycloak OIDC SSO, `X-VET-Token` API tokens.

Drivers, in order:

1. Few moving parts on one host, one language end to end.
2. The same team runs POD Studio, so reuse its stack and conventions where they fit.
3. The crawler reads known JSON (embedded HTML data and GraphQL responses), so it needs a real browser
   but no LLM extraction or generic crawling framework.
4. Phase 2 needs ERP SSO (OIDC) and HTTP contracts with POD Studio and the ERP, without a shared database.

## Decision

| Concern | Choice | Latest on npm, 2026-10-19 |
|---|---|---|
| Language and runtime | TypeScript strict, Node 24 (`engines.node` `^22.12.0 \|\| ^24 \|\| >=26`), pnpm workspaces | |
| Web | Next.js App Router + React, Tailwind v4 + shadcn/ui | next 16.4.2, react 19.3.1 |
| UI libraries | shadcn/ui components generated into the repo by the shadcn CLI on radix-ui primitives, styled with class-variance-authority, clsx, tailwind-merge and tw-animate-css; lucide-react icons (the set POD Studio uses); cmdk for the Ctrl+K command menu; sonner for the save toast with undo; recharts through the shadcn chart component for the keyword and shop line charts, with its required peer react-is declared directly; @dnd-kit/core for the Kanban board (draggable cards and droppable columns with pointer and keyboard sensors; no @dnd-kit/sortable, since cards are not reordered; keyboard moves use an app `coordinateGetter` that jumps to the next column, since the default sensor moves 25 px per press); the `geist` package for Geist and Geist Mono; sharp to re-encode uploaded idea images (web app) and PNG thumbnails (worker) to WebP; @axe-core/playwright and @playwright/test for e2e and accessibility checks. Built in, no package: `next/font/local` (loading the `geist` files), `next/image` (WebP thumbnails), Playwright `toHaveScreenshot`. See "UI libraries" below | shadcn 4.22.1 (CLI), radix-ui 1.8.1, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0, tw-animate-css 1.4.0, lucide-react 1.59.0, cmdk 1.1.1, sonner 2.0.8, recharts 3.10.1, react-is 19.3.1, @dnd-kit/core 6.3.1, geist 1.8.1, sharp 0.35.5, @axe-core/playwright 4.14.0, @playwright/test 1.64.1 |
| Auth | better-auth: email + password, admin plugin, sign-up disabled, telemetry disabled explicitly; generic OAuth/OIDC plugin for Keycloak in phase 2 | better-auth 1.7.11 |
| Database | Postgres 16 + Drizzle ORM (`node-postgres` driver, `pg` declared directly) and drizzle-kit migrations; text nanoid PKs with prefixes, `timestamptz` in UTC | drizzle-orm 0.45.4, pg 8.23.1, nanoid 6.0.2 |
| Jobs and schedule | pg-boss, three queues created with `createQueue` and worked by the worker in parallel, each with `localConcurrency` 1: `crawl.run` (policy `singleton`: one active job, any number queued; `retryLimit` 0; `expireInSeconds` = run deadline + grace + 5 min, 17400 s by default, at most 24 h; one job per run row, sent ahead with `startAfter` at its slot, its id kept on the row so it can be cancelled or failed), `briefing.build` (policy `exclusive`, since a key alone does nothing on a `standard` queue, with `singletonKey` = `${date}:global` or `${date}:kw:${keyword_id}`, one job per briefing, the global one at a higher `priority`; `retryLimit` 1; expiry 900 s by default) and `lark.send` (policy `standard`, `retryLimit` 3); jobs start from the run rows, not from cron schedules. The worker's scheduler keeps the run rows and their jobs 14 days ahead, sends each day's `briefing.build` jobs with `startAfter` at the build time, and applies a settings change within 1 minute by rewriting future rows and sending their jobs again, `cancel()` and `send()` in one transaction; the web app writes settings and Run now rows, each row and its job in one transaction (`send()` takes `{ db }`). Job expiry does not stop a running handler (`manager.js`), so the briefing and Lark handlers pass `job.signal` to the LLM client and `fetch` and run their queries under a `statement_timeout`. Checked in pg-boss 12.38.0 `types.d.ts`, `index.d.ts`, `plans.js`, `attorney.js` and `migrationStore.js` | pg-boss 12.38.0 |
| Crawler | Playwright library driving system Chrome, in a separate `worker` process; one adapter per source | playwright 1.64.1 |
| RSS | rss-parser | rss-parser 3.13.0 |
| LLM | `openai` SDK against an OpenAI-compatible base URL (`LLM_BASE_URL`, `LLM_API_KEY` from the environment; model name from admin settings only); output validated with zod, declared directly | openai 7.39.0, zod 4.6.7 |
| Lark | Lark Open API over `fetch` (tenant token + send message); own bot app | |
| Files | S3 API: MinIO in development and on the Linux desktop | |
| Dev services | Docker Compose for Postgres and MinIO only; app and worker run natively | |

### Versions and runtime

- **Node 24 at runtime, `engines.node` `^22.12.0 || ^24 || >=26`.** POD Studio's `package.json` floor
  is `>=22.12`, so Node 24 still matches driver 2. The range is the intersection of the chosen
  packages' engines: pg-boss 12.38.0 `>=22.12.0` (the strictest floor), nanoid 6.0.2
  `^22 || ^24 || >=26` (rules out Node 23 and 25), openai 7.39.0 `>=22.0.0`, next 16.4.2 `>=20.9.0`,
  playwright 1.64.1 `>=20`, react 19.3.1 `>=0.10.0`; better-auth 1.7.11, drizzle-orm 0.45.4 and
  rss-parser 3.13.0 declare none.
- Why 24 over 22: end of life is 2027-04-30 for Node 22 (about six months after this project starts)
  and 2028-04-30 for Node 24 (github.com/nodejs/Release `schedule.json`, read 2026-10-19). Node 22 has
  been in maintenance since 2025-10-21, and Node 24 enters maintenance on 2026-10-20, so the choice
  rests on the end-of-life date, not on LTS phase. The dry runs below ran on Node 24.21.0.
- The version column is the latest release on npm on 2026-10-19, not the version to install.
  `package.json` pins exact versions, preferring releases at least 1–2 weeks old at install time.
  better-auth 1.7.11 and openai 7.39.0 were both published on 2026-10-19, so the first install will
  likely pin earlier patch releases. playwright and @playwright/test 1.64.1 and react, react-dom and
  react-is 19.3.1 were published on 2026-10-14, also too new: playwright and @playwright/test are pinned
  to 1.63.0 (published 2026-09-04), POD Studio's pin, and react, react-dom and react-is likely to 19.3.0
  (2026-09-09), all three the same version; next 16.4.2 and recharts 3.10.1 accept React `^19.0.0` (npm
  view, 2026-10-19). Playwright 1.63.0 still falls back to a 180000 ms launch timeout in code
  (`_launchTimeout` and `DEFAULT_PLAYWRIGHT_LAUNCH_TIMEOUT` in playwright-core 1.63.0
  `lib/coreBundle.js`), although its `types.d.ts` documents 30000.
- rss-parser 3.13.0 is the latest release but dates from 2023-04-11, so the package is not actively
  maintained. Accepted for phase 1 because it reads only title, link, date and summary; replace it if a
  feed breaks it.
- better-auth 1.7.11 depends on `@better-auth/telemetry`. Checked in the published source: in
  `@better-auth/telemetry@1.7.11` `dist/index.mjs`, telemetry is enabled only if
  `BETTER_AUTH_TELEMETRY` is true or `telemetry.enabled` is true (both default false), and nothing is
  sent unless `BETTER_AUTH_TELEMETRY_ENDPOINT` is set (default `""` in `@better-auth/core@1.7.11`
  `dist/env/env-impl.mjs`). The docs' "now collects" line is a banner; the docs themselves say "if
  enabled". Ideas Hub still sets `telemetry: { enabled: false }` in the auth config for clarity.
  Re-checked at the likely pin: under the 1–2 week rule, the newest better-auth old enough on
  2026-10-19 is 1.7.7 (published 2026-09-30; 1.7.8–1.7.11 came out 2026-10-14 to 2026-10-19). It
  depends on `@better-auth/telemetry@1.7.7` and `@better-auth/core@1.7.7`, which have the same gating
  and the same empty endpoint default. Repeat the check if a different version is pinned at install.
- Dry runs at the install pins (Node 24.21.0, repeated 2026-10-20), `--dry-run --ignore-scripts`, no
  warnings in any, peer warnings included: next 16.4.2, react and react-dom 19.3.0, better-auth 1.7.11,
  drizzle-orm 0.45.4, pg-boss 12.38.0, playwright 1.63.0 and openai 7.39.0 (8 packages):
  - npm 12.2.0, those 8: 70 packages resolved. With react-dom left out, npm picks react-dom 19.3.1,
    whose peer is react `^19.3.1`, and fails with ERESOLVE, so react-dom is declared and pinned with
    react.
  - npm 12.2.0, the same 8 plus nanoid 6.0.2 and rss-parser 3.13.0 (10): 76.
  - npm 12.2.0, those 10 plus @playwright/test 1.63.0, react-is 19.3.0 and geist 1.7.2 (13): 79.
  - pnpm 12.9.1, the same 8: 103, resolving pg 8.23.1, zod 4.6.7 and playwright-core 1.63.0. npm and
    pnpm count differently, so 70 and 103 are not comparable.
  - pg is declared directly and pinned, because app code calls it through Drizzle's `node-postgres`
    driver. The pnpm dry run resolved pg 8.23.1: pg-boss 12.38.0 depends on pg `^8.23.1`, and
    drizzle-orm 0.45.4 and better-auth 1.7.11 take it as a peer, so one pinned copy serves all three.
  - zod is declared directly and pinned, because the app validates LLM output with it. The pnpm dry
    run resolved zod 4.6.7: better-auth 1.7.11 depends on zod `^4.5.4` and openai 7.39.0 takes it as a
    peer, so one pinned copy serves them and the app.
  - react-is is declared directly and pinned, because recharts 3.10.1 takes it as a required peer
    (`^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`, no `peerDependenciesMeta`, `npm view` on 2026-10-19).
    It is pinned to the same version as react, 19.3.0 at install (19.3.1, published 2026-10-14, is too
    new), so one copy matches the React that renders the charts.
  - Not covered by any dry run: drizzle-kit, TypeScript, Tailwind, the UI libraries below (sharp
    included; @playwright/test and geist are in the third npm run) and the S3 client. The no-warning
    result holds only for the packages listed.

### UI libraries

- The UI libraries row lists the npm latest versions on 2026-10-19 (re-checked with `npm view` the same
  day), not the versions to install. Several are days old (shadcn 4.22.1 published 2026-10-18,
  lucide-react 1.59.0 2026-10-17, @axe-core/playwright 4.14.0 2026-10-15, radix-ui 1.8.1 2026-10-12), so
  under the 1–2 week rule above the install will pin earlier releases. Where POD Studio already pins a
  package, its version is preferred, e.g. lucide-react 1.49.0 in its `apps/web/package.json`. The shadcn
  CLI runs with `pnpm dlx` and is not a dependency. All React peers accept React 19.
- @playwright/test is pinned to the same version as playwright, 1.63.0 (above), so the test runner and
  the crawler share one browser build.
- geist: 1.8.1 is the latest (published 2026-10-16), so under the 1–2 week rule the install will likely
  pin 1.7.2 (2026-06-01); its `geist/font/sans` is a `next/font/local` call on `Geist-Variable.woff2`,
  it takes next `>=13.2.0` as a peer, and its Geist and Geist Mono variable fonts contain every
  Vietnamese letter (checked in the 1.7.2 tarball with fontTools). POD Studio loads the same family
  through `@fontsource/geist`; `next/font/local` is used here so the font files ship with the build.
- sharp is declared directly and pinned to 0.35.5 (published 2026-09-27): next 16.4.2 lists it only as
  an optional dependency (`^0.35.5`), and the upload route and the worker's PNG re-encode call it.
- shadcn's registry brings its own dependencies: `shadcn add sonner` adds next-themes and
  `shadcn add chart` adds recharts 3.8.0 (registry style `new-york-v4`, read 2026-10-19), while this ADR
  pins recharts 3.10.1 and adds no next-themes. After every `shadcn add`, `package.json` is checked
  against these pins and restored, and `components/ui/sonner.tsx` uses `theme="light"` without
  `useTheme`.
- Not added, for lack of a confirmed need: TanStack Table (sorting and filtering run on the server),
  motion (CSS transitions are enough), nuqs (URL state goes through Next's `searchParams`), next-themes
  (no dark mode in phase 1), an i18n library (one UI language, one string dictionary).
- Thumbnails: Next 16 refuses by default to optimize images from private IPs
  (`images.dangerouslyAllowLocalIP`, Next.js 16 upgrade guide), and MinIO runs on localhost. Thumbnails
  therefore go through an app route, and since the image optimizer does not forward headers or cookies
  when it fetches the source image (`fetchInternalImage` in next 16.4.2 `dist/server/image-optimizer.js`
  builds its request with `headers: {}`), that route cannot check the session. It uses signed URLs
  instead: `/thumbs/[sig]/[key]`, `sig` being the HMAC-SHA256 of the decoded key with
  `THUMB_URL_SECRET`, without expiry so the `/_next/image` cache is not churned; a wrong signature gets
  a 404 response. `proxy.ts` still requires a session for pages and `/_next/image`. `next/image` allows
  the path with `images.localPatterns` (`/thumbs/**`) and serves WebP, the default `images.formats`
  (`dist/shared/lib/image-config.js`); 320 is added to `images.imageSizes`, whose default (32, 48, 64,
  96, 128, 256, 384) has no 320, so a 320 px card gets 320 px at 1x and 640 px, a default device size,
  at 2x. Images uploaded for manual ideas are per-store data and are served by their own route, which
  checks the session and store scope. They are uploaded through a route handler, left out of the proxy
  `matcher` so the proxy does not buffer the body, that refuses a body over 5 MB + 64 KB, since a Server
  Action body is capped at 1 MB by default (next 16.4.2 `dist/server/app-render/action-handler.js` lines
  513–515) and raising `experimental.serverActions.bodySizeLimit` would raise it for every action.
  `dangerouslyAllowLocalIP` stays off. The worker stores thumbnails with keys of the form the route
  accepts.

Layout: `apps/web`, `apps/worker`, `packages/db` (schema, migrations), `packages/core` (domain logic,
permission checks, scoring), `packages/sources/*` (one adapter per source).

Ports (avoiding 3100, 20128, 1933, 11434, 8642, 40325 already used on the dev machine): web 3300,
Postgres 5433, MinIO 9300 (API) and 9301 (console). All three were free on 2026-10-19.

Production on the Linux desktop follows POD Studio's pattern: systemd user services (`ideashub-web`,
`ideashub-worker`), its own Docker Compose project and database, its own Cloudflare tunnel hostname. The
worker is tied to the desktop session because it drives Chrome. A systemd user timer starts the watchdog
(`pnpm watchdog`, a short-lived process outside the worker) every 5 min; it alerts on missed slots and a
lost heartbeat, closes hung runs and restarts `ideashub-worker` with `systemctl --user restart`. On
Windows, during development and the plan's Step 4 measurement, Task Scheduler starts the watchdog every
5 min and runs the worker as a task whose wrapper loop restarts it after it exits; the watchdog can also
restart that task.

## Alternatives considered

- **Python worker (Crawl4AI or crawlee-python) with a TypeScript web app**, as in POD Studio. Rejected
  for phase 1: two languages and two toolchains for one site whose data is already JSON. Revisit if news
  reading needs full-article LLM extraction.
- **Crawlee (TypeScript)**: its request queue, storage and session pool overlap pg-boss, and with one
  browser and one tab its retry and rotation features add little. Revisit when proxies or several
  browser profiles are switched on.
- **Frappe app inside the ERP**: would tie Ideas Hub to the ERP's release cycle and database, which
  phase 1 rules out; the ERP is also outside this repo's write scope.
- **Lighter web stack (Vite SPA + Hono)**: fewer concepts, but loses the shared know-how and component
  conventions with POD Studio.
- **Keycloak SSO from day one**: needs ERP-side group and client setup; deferred to phase 2. The
  better-auth OIDC plugin keeps that path open.

## Consequences

- One `pnpm install` and one language for web, worker and jobs. Domain rules such as `days_active`, the
  trend score and permission checks live once in `packages/core` with unit tests.
- The worker talks to Postgres directly through pg-boss. Moving it to another machine later means a
  network path to the database, or an HTTP lease API like POD Studio's worker API; either one is a new
  ADR.
- Next.js and pg-boss versions should move together with POD Studio's where practical, so both apps
  share upgrade notes.
- Decisions still to record as their own ADRs: data model (after the first migration), Facebook
  accounts or proxies (only if measurements call for it), the integration contract (before phase 2).
