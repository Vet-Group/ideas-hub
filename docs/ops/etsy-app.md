# Etsy Personal App application (phase 3 item 8)

Status: **registered 2026-10-29, Pending Personal Approval.** When Etsy approves it, the key goes into
the host's environment (never into the repo), and the Etsy section of the keyword report switches on.

## Registration (2026-10-29)

| Field | Value |
|---|---|
| App name | `vet-ideas-market-research` |
| Status | Pending Personal Approval; check it at <https://www.etsy.com/developers/your-apps> |
| Quota | 5 requests a second, 5,000 requests a day |
| Category | Seller Tools |
| Who will use it | "Just myself or colleagues" |
| Commercial | No |
| Scopes | None: no listing, sales or email scopes (public listing data needs only the API key) |

The form's description field takes at most 500 characters, so this shorter text was used instead of the
long draft under "Fields to paste" (468 characters):

> Internal research tool for our small print-on-demand team (under 10 staff). For keywords we already track (e.g. "dog mom shirt"), it searches public active listings and shows a summary: price range, common tags and median favorers. Read-only: it never lists, edits or buys anything and uses no private member data. Low volume: a few hundred requests a day at 1 request/second with backoff on 429. Results are cached at most 24 hours; no scraping. Not endorsed by Etsy.

## Etsy API Terms that shape the code

Read in the accept dialog at registration, 2026-10-29:

- **6 hours:** item content and product information shown must be at most 6 hours older than on Etsy (other
  Etsy content: 24 hours). The description above says 24 hours; the code keeps listing data at most 6 hours
  (`CACHE_MS` in `packages/sources/etsy/src/index.ts`), in memory only, never in Postgres.
- Cache only for reasonable periods; no scraping.
- Link back to the listing on Etsy: every listing shown links to its Etsy `url`.
- Show a contact email: `ETSY_CONTACT_EMAIL`, shown under the data with "Dữ liệu từ Etsy" and the Etsy
  trademark notice.

## Which access

A **Personal App** (Etsy Open API v3). It needs an Etsy account but no shop, and goes through a manual
review that has taken weeks for some developers. A Seller App is instant but sees only the applicant's own
shop, so it cannot search the market. Commercial Access is not needed: the app is internal and used by a
handful of staff. Source: [Etsy Open API v3 documentation](https://developers.etsy.com/documentation/),
read 2026-10-29.

## Steps

1. Sign in at <https://www.etsy.com/developers/register> with the company's Etsy account.
2. Choose **Create a personal app** and paste the fields below.
3. When the app is approved, put the keystring and shared secret in the host's Ideas Hub environment as
   `ETSY_API_KEY` and `ETSY_SHARED_SECRET`, plus `ETSY_CONTACT_EMAIL` (see `docs/ops/production.md`
   "Environment"), recheck the live API Terms, and tell the developer.

## Fields to paste

**App name:** VET Ideas Market Research

**Website:** https://ideas.vetgroup.net (internal, sign-in required)

**What will your app do?**

> VET Ideas is an internal research tool used by a small print-on-demand team (fewer than 10 staff) to
> decide which product ideas to design. For a keyword the team already tracks (for example "dog mom
> shirt"), the app calls the public active-listings search of the Open API and shows the team a summary:
> the price range of matching listings, the most common tags and the median number of favorers. It does
> not sell, list or change anything on Etsy, does not access any member's private data, and does not use
> OAuth scopes beyond public listing data.
>
> Usage is low: a few hundred requests a day at most, paced at one request per second with backoff on
> HTTP 429. Results are cached for no more than 24 hours and are not stored as a long-term database; the
> app does not screen-scrape Etsy and shows "data from Etsy" next to every figure. The app is not
> endorsed or certified by Etsy, Inc.

## What the app will use

- `GET /v3/application/listings/active` with `keywords`, `limit` (100), `offset` (0: one page per keyword)
  and `sort_on=score`, header `x-api-key: <keystring>:<shared secret>`, 1 request a second, one retry
  after `Retry-After` on 429 (up to 10 s), otherwise "unavailable".
- From each listing: `price` and `currency_code`, `tags`, `num_favorers`, `title`, `url`.
- Price bands are computed per currency, never across currencies.
