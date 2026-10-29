# Etsy Personal App application (phase 3 item 8)

Status: text ready 2026-10-29. The owner registers the app; the Etsy key then goes into the host's
environment (never into the repo), and the Etsy section of the keyword report switches on.

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
   `ETSY_API_KEY` and `ETSY_SHARED_SECRET` (see `docs/ops/production.md`), and tell the developer.

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

- `GET /v3/application/listings/active` with `keywords`, `limit` (100) and `offset`, sorted by score.
- From each listing: `price` and `currency_code`, `tags`, `num_favorers`, `title`, `url`.
- Price bands are computed per currency, never across currencies.
