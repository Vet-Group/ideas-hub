/** Query parameters that only track a click; they never change which product page an ad lands on. */
const TRACKING_PARAMS = ['fbclid', 'gclid', 'ttclid', 'msclkid'];

/**
 * A landing URL reduced to its product page: lower-case host (the URL parser does that), no fragment, no
 * `utm_*` or click-id parameters, remaining parameters sorted, no trailing slash. Null when it is not an
 * absolute URL.
 */
export function canonicalizeUrl(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}
