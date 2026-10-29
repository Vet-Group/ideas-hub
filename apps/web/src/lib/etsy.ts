// The keyword report's Etsy section (AC-S2): on only when the host's env has the app's keystring, shared secret
// and the contact email the Etsy API Terms ask the app to show (docs/ops/etsy-app.md). Nothing goes to Postgres;
// the client's in-memory cache keeps a result at most 6 h.
import 'server-only';
import { type EtsyResult, createEtsyClient } from '@ideas-hub/etsy';

export function etsyContactEmail(): string | null {
  const { ETSY_API_KEY, ETSY_SHARED_SECRET, ETSY_CONTACT_EMAIL } = process.env;
  return ETSY_API_KEY && ETSY_SHARED_SECRET && ETSY_CONTACT_EMAIL ? ETSY_CONTACT_EMAIL : null;
}

let client: ReturnType<typeof createEtsyClient> | undefined;

/** The keyword's Etsy summary, or null when Etsy is off or unavailable. */
export async function etsyMarket(keyword: string): Promise<EtsyResult | null> {
  if (!etsyContactEmail()) return null;
  client ??= createEtsyClient({ apiKey: process.env.ETSY_API_KEY!, sharedSecret: process.env.ETSY_SHARED_SECRET! });
  try {
    return await client.search(keyword);
  } catch (e) {
    // The package's messages never hold the key; a network error has no request headers in it.
    console.error('etsy: search failed:', e instanceof Error ? e.message : 'unknown error');
    return null;
  }
}
