# Contract: Ideas Hub integration v1

Status: **Draft (2026-10-20)**. Pending owner: review with the POD Studio owner; agree on every item
marked "to confirm with the POD Studio owner" before phase 2. Nothing in this contract is built in
phase 1 (spec §5): there is no `/api/v1` route, no token table and no call to POD Studio.

Inputs: spec §2 "Main entities", §4 and §5, ADR 0001 (stack), ADR 0002 (data model),
`apps/web/src/proxy.ts`, `apps/web/src/lib/auth.ts`, `packages/core/src/access.ts`,
`packages/core/src/briefing/sections.ts`, `packages/db/src/schema/*.ts`. POD Studio's code was not read
for this draft: every POD Studio-side detail below is a proposal from Ideas Hub's side.

## 1. Cross-app keys

Phase 1 already stores these, so the integration needs no data migration of existing rows.

| Key | Where in Ideas Hub | Matches |
|---|---|---|
| User email | `users.email`, unique case-insensitively (`lower(email)`) | The user's email in POD Studio and in the ERP (Keycloak in phase 2). Compared lower-cased. |
| `erp_store_code` | `stores.erp_store_code` (nullable) | The ERP store code; phase 2 SSO maps Keycloak groups `store-<code>` to it. |
| `pod_studio_store_id` | `stores.pod_studio_store_id` (nullable) | POD Studio's store id, as a string. To confirm with the POD Studio owner: its format (POD Studio's own id or a slug) and whether it is stable for the life of the store. |
| Ideas Hub ids | `idea_…`, `brf_…`, `sug_…`, `store_…`, `kw_…` (prefixed nanoids) | Never change; other apps may store them. `ads` are keyed by Facebook's `ad_archive_id`. |

A store without `pod_studio_store_id` cannot push ideas to POD Studio; a store without
`erp_store_code` cannot be matched by phase 2 SSO. Admins set both on `/admin/stores`.

## 2. Ideas Hub pushes a saved idea to POD Studio

Direction: Ideas Hub calls POD Studio. POD Studio never calls Ideas Hub for this flow, so it needs no
network path to Ideas Hub and no Ideas Hub token.

### When

A user with `save` on the idea's store presses a "Send to POD Studio" action on the idea (phase 2 UI),
for a store whose `pod_studio_store_id` is set. One push per (idea, POD Studio store); pushing the same
idea again returns the same POD Studio item (idempotency below). Nothing is pushed automatically in v1.

### Authentication

- POD Studio's REST tool API with a **personal access token** (PAT), sent as
  `Authorization: Bearer <pod-studio-token>`.
- Ideas Hub holds one token per install, in the environment (`POD_STUDIO_TOKEN`, never in the repo or
  the database), belonging to a POD Studio service user with the right to create items in the mapped
  stores. To confirm with the POD Studio owner: whether POD Studio PATs are per user or per service
  account, their scopes, expiry and rotation, and whether one token may write to several stores.
- Ideas Hub sends the pushing user's email in the body (`pushed_by_email`) so POD Studio can record who
  pushed it; the token decides what is allowed, never that field.

### Request (proposed)

`POST <pod-studio-base-url>/<tool-api-path>` — to confirm with the POD Studio owner: the base URL
(reached from the Linux desktop, both apps run on it), the path, and the name of the POD Studio object an
idea becomes (an "idea", a "design brief", a task).

Headers:

- `Authorization: Bearer <pod-studio-token>`
- `Idempotency-Key: <idea id>:<pod_studio_store_id>` (for example `idea_V1StGXR8_Z5jdHi6B-myT:<pod-store-id>`)
- `Content-Type: multipart/form-data` with a `payload` JSON part and an optional `image` part, or
  `application/json` when there is no image. To confirm with the POD Studio owner: whether the tool API
  accepts multipart; if not, the image goes as a separate upload call whose id the JSON carries.

The `payload` part (field names follow the Ideas Hub schema; POD Studio maps them to its own model):

```json
{
  "contract": "ideas-hub-v1",
  "pod_studio_store_id": "<pod-store-id>",
  "ideas_hub": {
    "idea_id": "idea_V1StGXR8_Z5jdHi6B-myT",
    "store_id": "store_Uakgb_J5m9g-0JDMbcJqL",
    "url": "https://<ideas-hub-hostname>/ideas/idea_V1StGXR8_Z5jdHi6B-myT"
  },
  "title": "Custom pet portrait hoodie, Halloween edition",
  "notes": "Try with our cat line; compare price with shop X.",
  "tags": ["halloween", "pets"],
  "status": "picked",
  "source": {
    "kind": "ad",
    "via": "briefing",
    "ad_archive_id": "1234567890123456",
    "ad_library_url": "https://www.facebook.com/ads/library/?id=1234567890123456",
    "link": "https://shop.example.com/products/pet-hoodie",
    "landing_domain": "shop.example.com",
    "page_name": "Example Pet Shop",
    "caption": "Turn your pet into a spooky hoodie...",
    "keyword": "pet hoodie",
    "trend_score": 0.82,
    "media_type": "image"
  },
  "created_by_email": "member@example.com",
  "created_at": "2026-11-02T01:12:44.000Z",
  "pushed_by_email": "member@example.com"
}
```

- `source.kind` is `ad`, `suggestion` or `manual` (`saved_ideas.source`); `via` is `briefing`, `ads` or
  `manual`. For a suggestion, `source` carries `suggestion_id`, `text`, `reason` and `keyword` instead
  of the ad fields; for a manual idea, `link` (when one was pasted) only. Fields missing from the
  snapshot are `null`, never omitted.
- `image` part: the idea's picture as bytes (`image/webp` or `image/jpeg`, at most 5 MB): the ad
  thumbnail from the `thumbs/` prefix for ad ideas, the uploaded image for manual ones, nothing for a
  suggestion. Ideas Hub sends bytes rather than a link because `/thumbs/[sig]/[key]` URLs never expire
  (they are bearer links) and uploaded idea images are per-store data with no public URL (spec §2).

### Response expected by Ideas Hub

| Status | Meaning | Ideas Hub does |
|---|---|---|
| `201 Created` | Item created | Stores the returned id and URL on the idea, shows "Đã gửi sang POD Studio · Mở" |
| `200 OK` | Same `Idempotency-Key` seen before; the existing item | Same as 201 |
| `400` / `422` | Payload refused | No retry; shows the error message to the user and logs the body |
| `401` / `403` | Token missing, expired, or not allowed for that store | No retry; raises an admin Alert ("POD Studio token") |
| `404` | Unknown `pod_studio_store_id` | No retry; the admin fixes the store mapping |
| `409` | Same key with a different payload | No retry; logged for the admin |
| `413` | Image too large | Retries once without the image |
| `429`, `5xx`, timeout, network error | Temporary | Retries with backoff (below), same key |

Body of `201`/`200` (to confirm with the POD Studio owner):

```json
{ "id": "<pod-item-id>", "url": "https://<pod-studio-hostname>/<path-to-item>", "created_at": "2026-11-02T01:15:03.000Z" }
```

Errors: Ideas Hub reads `{ "error": { "code": "...", "message": "..." } }` when present, otherwise the
status line. To confirm with the POD Studio owner: POD Studio's actual error shape and its rate limits.

### Ideas Hub side (phase 2, not built)

- A `pod.push` pg-boss queue (`standard`, `retryLimit` 3, backoff, request timeout 30 s), so a POD
  Studio outage never blocks the page; the job sends the same `Idempotency-Key` on every attempt.
- New nullable columns on `saved_ideas`: `pod_studio_item_id`, `pod_studio_url`, `pushed_at` (a phase 2
  migration; recorded in an ADR with this contract's final version).
- To confirm with the POD Studio owner: whether POD Studio wants status updates later (Picked → Done
  in Ideas Hub, or the reverse). Not in v1.

## 3. Ideas Hub `/api/v1` read endpoints

Direction: other apps (POD Studio, the ERP, scripts) read briefings and ideas from Ideas Hub. Read-only
in v1.

### Base URL and transport

- `https://<ideas-hub-hostname>/api/v1`, the Cloudflare tunnel hostname of the Linux install. HTTPS
  only; JSON in UTF-8.
- `proxy.ts` sends every request without a session to `/login`, so the `/api/v1/` prefix must be left
  out of the session check (like `/api/auth/`); the route handlers check the bearer token themselves and
  never accept the session cookie, so a browser page cannot be used to call them cross-site.

### Personal tokens

- Created by a signed-in user for themselves on a "Tokens" page (phase 2); admins may create one for a
  service user they created for an app. Shown once, as `ihp_` followed by 40 random base62 characters.
  Stored only as a SHA-256 hash, with its owner, name, scopes, optional store list, `expires_at`
  (default 90 days, at most 365), `last_used_at` and `revoked_at`.
- Sent as `Authorization: Bearer ihp_…`. Never in a query string.
- **A token acts as its owner**, checked at every request: a disabled owner, or a revoked or expired
  token, gets `401`. The owner's role and store ticks are read at request time, so removing a member
  from a store removes that store from their tokens at once.
- **Scopes** (v1): `briefings:read`, `ideas:read`. A token has one or both. A request outside the
  token's scopes gets `403 insufficient_scope`.
- **Store list** (optional): narrows the token to some of the owner's stores. Effective stores of a
  request = stores where the owner has `view` (directly, or implied by `save` or `keywords`), all stores
  for an admin, intersected with the token's store list when it has one. The check goes through
  `storeScope()` in `packages/core/src/access.ts`, as every page does.

### Store scoping (spec §4, plan AC 4)

- Ideas: only ideas of effective stores. An idea outside them is `404 not_found`, never `403`, so the
  API does not reveal that it exists (as the app's pages do).
- Global briefings and sections 1–4 of keyword briefings are shared data: any token with
  `briefings:read` reads them.
- The AI sections of a keyword briefing (`news`, `suggestions`) follow `canSeeKeywordAi`: admins, seed
  keywords for everyone, otherwise a `view` on a store that tracks the keyword, within the effective
  stores. When hidden, the section is `{ "state": "hidden" }` and its suggestions are not listed.
- **Which store tracks a keyword is never returned**, to any token, admin included (spec §2: only
  admins see it, in the app). Keyword text is shared and is returned.
- Run triggers (`manual` vs `schedule`) and who triggered a run are not in this API.

### Endpoints

| Method and path | Scope | Returns |
|---|---|---|
| `GET /api/v1/me` | any | The token's owner (`email`, `role`), scopes, `expires_at` and effective stores |
| `GET /api/v1/stores` | any | Effective stores: `id`, `name`, `erp_store_code`, `pod_studio_store_id` |
| `GET /api/v1/briefings` | `briefings:read` | Ready briefings, newest first; filters `scope` (`global`, `keyword`), `keyword_id`, `date_from`, `date_to` |
| `GET /api/v1/briefings/latest` | `briefings:read` | The latest ready global briefing (what `/briefing` shows) |
| `GET /api/v1/briefings/{id}` | `briefings:read` | One briefing with sections and suggestions |
| `GET /api/v1/ideas` | `ideas:read` | Ideas of effective stores; filters `store_id`, `status`, `via`, `source`, `updated_since` |
| `GET /api/v1/ideas/{id}` | `ideas:read` | One idea |
| `GET /api/v1/ideas/{id}/image` | `ideas:read` | The uploaded image of a manual idea, `Cache-Control: private, no-store`; `404` if none |

Only briefings with `ready_at` set are listed or returned; a briefing still building is `404`.

### Representation

- JSON keys are `snake_case`. The stored `briefings.sections` jsonb is camelCase
  (`packages/core/src/briefing/sections.ts`); the API maps it field by field, so the stored shape can
  change without breaking v1.
- Timestamps are ISO 8601 in UTC with `Z` (`2026-11-02T01:12:44.000Z`). A briefing's `date` is its
  Asia/Ho_Chi_Minh date (`YYYY-MM-DD`); `baseline_day` in a delta is a Pacific crawl day (spec §3).
- Thumbnails: `thumbnail_url` is the signed `/thumbs/[sig]/[key]` URL that pages render (shared research
  data, served without a session); `null` without a thumbnail. An idea's own uploaded image is never a
  URL: `has_image: true` and the `/image` endpoint above.
- Clients ignore unknown fields and treat an unknown enum value as "other" (see "Versioning").

Example: `GET /api/v1/briefings/latest`

```json
{
  "data": {
    "id": "brf_8nB2kq4T0vX1aZp9LmQe3",
    "date": "2026-11-02",
    "scope": "global",
    "keyword": null,
    "ready_at": "2026-11-01T23:41:07.000Z",
    "source_run": {
      "id": "run_Q2w9Ld0pR7sYt5Kc1Vb8n",
      "scheduled_for": "2026-11-01T18:00:00.000Z",
      "running_ads": 4120,
      "ok_searches": 158,
      "planned_searches": 160
    },
    "kpi": {
      "running_ads": 4120,
      "delta": { "change": 214, "baseline_day": "2026-10-25", "partial": false },
      "ok_rate": 0.9875,
      "next_holiday": { "date": "2026-11-26", "name": "Thanksgiving", "days": 24 }
    },
    "top_ads": [
      {
        "ad_archive_id": "1234567890123456",
        "ad_library_url": "https://www.facebook.com/ads/library/?id=1234567890123456",
        "page_name": "Example Pet Shop",
        "caption": "Turn your pet into a spooky hoodie...",
        "landing_domain": "shop.example.com",
        "thumbnail_url": "https://<ideas-hub-hostname>/thumbs/<sig>/<key>.webp",
        "keyword": "pet hoodie",
        "countries": ["AU", "CA", "GB", "US"],
        "days_active": 19,
        "trend_score": 0.82
      }
    ],
    "rising_ads": [],
    "hot_keywords": [
      { "key": "kw_3fT9pLq0Zs2Xw8Nb6Vc1d", "label": "pet hoodie", "running_ads": 310, "delta": { "change": 42, "baseline_day": "2026-10-25", "partial": false } }
    ],
    "rising_shops": [
      { "key": "shop.example.com", "label": "shop.example.com", "running_ads": 27, "delta": null }
    ],
    "news": {
      "state": "ok",
      "summary": "…",
      "items": [{ "id": "news_7Hk2…", "title": "…", "link": "https://news.example.com/a", "published_at": "2026-11-01T14:00:00.000Z", "feed": "Example feed" }],
      "holidays": [{ "date": "2026-11-26", "name": "Thanksgiving", "days": 24 }]
    },
    "suggestions": {
      "state": "ok",
      "items": [
        {
          "id": "sug_Lm4Rt8Yq1Wx6Zp0Bn3Kc7",
          "kind": "idea",
          "text": "Halloween pet hoodies with the owner's photo",
          "reason": "…",
          "evidence": { "ads": ["1234567890123456"], "news": ["news_7Hk2…"] }
        }
      ]
    }
  }
}
```

A section that was not generated is `{ "state": "skipped", "reason": "cost_cap" }` or
`{ "state": "failed", "reason": "ai" }` (spec §3), with `news.items` and `news.holidays` still present;
a hidden AI section of a keyword briefing is `{ "state": "hidden" }`. A keyword briefing has
`"scope": "keyword"` and `"keyword": { "id": "kw_…", "text": "pet hoodie" }`.

Example: `GET /api/v1/ideas?store_id=store_Uakgb_J5m9g-0JDMbcJqL&status=picked&limit=2`

```json
{
  "data": [
    {
      "id": "idea_V1StGXR8_Z5jdHi6B-myT",
      "store_id": "store_Uakgb_J5m9g-0JDMbcJqL",
      "source": "ad",
      "source_ref": "1234567890123456",
      "via": "briefing",
      "title": "Custom pet portrait hoodie, Halloween edition",
      "notes": "Try with our cat line.",
      "tags": ["halloween", "pets"],
      "status": "picked",
      "assignee_email": "member@example.com",
      "created_by_email": "member@example.com",
      "created_at": "2026-11-02T01:12:44.000Z",
      "updated_at": "2026-11-02T03:40:10.000Z",
      "has_image": false,
      "snapshot": {
        "thumbnail_url": "https://<ideas-hub-hostname>/thumbs/<sig>/<key>.webp",
        "caption": "Turn your pet into a spooky hoodie...",
        "link": "https://shop.example.com/products/pet-hoodie",
        "ad_library_url": "https://www.facebook.com/ads/library/?id=1234567890123456",
        "page_name": "Example Pet Shop",
        "landing_domain": "shop.example.com",
        "keyword": "pet hoodie",
        "trend_score": 0.82,
        "media_type": "image"
      },
      "url": "https://<ideas-hub-hostname>/ideas/idea_V1StGXR8_Z5jdHi6B-myT"
    }
  ],
  "next_cursor": "eyJ1IjoiMjAyNi0xMS0wMlQwMzo0MDoxMC4wMDBaIiwiaSI6ImlkZWFfVjFTdCJ9"
}
```

The snapshot keeps the key in the database and signs it when the response is built, as pages do.
Users are returned by email only, never by Ideas Hub user id.

### Pagination

- Cursor pagination on every list: `limit` (default 50, 1–200) and `cursor` (the previous response's
  `next_cursor`, opaque). `next_cursor` is `null` on the last page.
- Order is fixed: ideas by (`updated_at` desc, `id` desc); briefings by (`date` desc, `id` desc). A cursor
  encodes the last row's sort key, so rows changed during paging are neither skipped nor repeated
  within one pass, except an idea that moves because it was updated.
- A cursor from a different filter set gets `400 invalid_cursor`.

### Errors

Every error has the same body; `message` is English and meant for developers, not end users:

```json
{ "error": { "code": "not_found", "message": "Idea not found.", "request_id": "req_4Gm8Zt1Qw9" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request`, `invalid_cursor` | Bad parameter, unknown filter value, cursor of another query |
| 401 | `unauthorized` | No token, unknown, expired or revoked token, disabled owner |
| 403 | `insufficient_scope` | The token lacks the endpoint's scope |
| 404 | `not_found` | Unknown id, or a row outside the token's stores |
| 429 | `rate_limited` | Over the limit below |
| 500 | `internal` | Anything else; `request_id` is in the server log |

### Rate limits

- 60 requests per minute per token, and 600 per minute per install across all tokens (one web process
  on one machine, so a counter in that process is enough in v1; it resets on restart).
- Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds); a
  `429` also carries `Retry-After`. Clients back off and retry after it.

### Versioning and deprecation

- The version is the path prefix: `/api/v1`. Within v1 changes are additive only: new endpoints, new
  optional parameters, new response fields, new enum values. Clients must ignore unknown fields and
  handle unknown enum values.
- Removing or renaming a field, changing a type or meaning, tightening a limit, or changing auth is a
  breaking change and goes to `/api/v2`. v1 keeps working for at least 90 days after v2 ships.
- A deprecated endpoint or version answers with `Deprecation: true` and `Sunset: <HTTP date>` headers
  and a `Link: <…/docs/contracts/…>; rel="deprecation"` header, from the day the deprecation is
  announced in this file's changelog.
- This document is the contract: a change is a pull request to it, agreed by both sides, with an entry
  in the changelog below.

## 4. Out of scope for v1

- Any write through `/api/v1` (creating ideas, changing status, notes or assignee); webhooks or events
  pushed from Ideas Hub; status sync back from POD Studio.
- Reading ads, shops, keywords, run history, alerts or settings through the API (the app's pages and
  CSV export cover phase 1).
- Which store tracks which keyword, who triggered a run, AI cost per briefing.
- OAuth flows, SSO, and Keycloak tokens on the API (phase 2 SSO is for the web sign-in; whether API
  tokens later accept Keycloak access tokens needs a new contract version).
- Calls from Ideas Hub to the ERP, and any shared database with POD Studio or the ERP (spec §5; a new
  ADR would be needed).
- Bulk export beyond the paginated lists.

## 5. Open items

- To confirm with the POD Studio owner: the tool API path and object, PAT model and scopes, multipart
  support, response and error shapes, rate limits, `pod_studio_store_id` format, and whether POD Studio
  wants to read `/api/v1` with its own service user.
- The Ideas Hub hostname (`<ideas-hub-hostname>`) is the Linux trial's tunnel hostname, chosen by the
  owner (`docs/ops/linux-trial.md`).
- Whether the tunnel hostname is put behind Cloudflare Access. If it is, `/api/v1/` and `/thumbs/` need
  a bypass or a service token for other apps, and this contract gains that header.

## Changelog

- 2026-10-20: first draft (plan Step 8).
