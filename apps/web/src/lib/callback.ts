export const DEFAULT_PAGE = '/briefing';

const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * Where sign-in sends the user: a same-origin path only. The callback is checked both as given and
 * percent-decoded, so `/%09/example.com` (a tab that a browser may drop, leaving `//example.com`) and
 * any other control character, protocol-relative or absolute URL to another host go to the briefing.
 */
export function safeCallback(cb: string | null | undefined, origin: string): string {
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
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_PAGE;
  }
}
