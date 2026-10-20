export const DEFAULT_PAGE = '/briefing';

const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * Where sign-in sends the user: a same-origin path only. The callback is checked both as given and
 * percent-decoded, so `/%09/example.com` (a tab that a browser may drop, leaving `//example.com`) and
 * any other control character, protocol-relative or absolute URL to another host go to the briefing.
 * Idempotent: a result that the same check would change again (`/%2e%2e/%2fexample.com` normalises to
 * `/%2fexample.com`, which decodes to `//example.com`) goes to the briefing too.
 */
export function safeCallback(cb: string | null | undefined, origin: string): string {
  const out = checkOnce(cb, origin);
  return checkOnce(out, origin) === out ? out : DEFAULT_PAGE;
}

function checkOnce(cb: string | null | undefined, origin: string): string {
  if (!cb) return DEFAULT_PAGE;
  let decoded: string;
  try {
    decoded = decodeURIComponent(cb);
  } catch {
    return DEFAULT_PAGE;
  }
  if (hasControl(cb) || hasControl(decoded) || /^[/\\]{2}/.test(decoded)) return DEFAULT_PAGE;
  try {
    const url = new URL(cb, origin);
    if (url.origin !== origin || new URL(decoded, origin).origin !== origin) return DEFAULT_PAGE;
    // Dot segments can normalise to `//host` (`/..//example.com`), which a redirect reads as another host.
    if (/^\/[/\\]/.test(url.pathname)) return DEFAULT_PAGE;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_PAGE;
  }
}
