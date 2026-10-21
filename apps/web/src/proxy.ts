import { type NextRequest, NextResponse } from 'next/server';
import { auth } from './lib/auth';

/**
 * Every page and `/_next/image` needs a session (spec §6, plan Step 5). A full `getSession()` is one
 * database lookup per request: a cookie-only check would let a disabled user keep loading pages and
 * thumbnails. On a full page load it also extends the session and writes the cookie on the response;
 * soft navigations (`RSC: 1` without `next-action`) never extend it, as `nextCookies()` does.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // /api/health is the deploy's and the tunnel's probe; it returns no data.
  if (pathname === '/login' || pathname === '/api/health' || pathname.startsWith('/api/auth/') || pathname.startsWith('/thumbs/')) return NextResponse.next();

  const soft = req.headers.get('rsc') === '1' && !req.headers.get('next-action');
  const { response: session, headers } = await auth.api.getSession({
    headers: req.headers,
    query: { disableRefresh: soft },
    returnHeaders: true,
  });
  if (!session || session.user.banned) {
    if (pathname.startsWith('/_next/image')) return new NextResponse(null, { status: 401 });
    const login = new URL('/login', req.url);
    login.searchParams.set('callbackURL', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  const res = NextResponse.next();
  for (const cookie of headers.getSetCookie()) res.headers.append('set-cookie', cookie);
  return res;
}

export const config = {
  // Leaves out static files and `/api/ideas/manual` (it checks the session itself, so its upload is not
  // buffered here) and paths ending in a listed extension; never every path with a dot, since
  // `/shops/example.com` is a page. `/_next/image` stays in.
  matcher: ['/((?!_next/static/|api/ideas/manual$|.*\\.(?:css|js|map|woff2?|ico|png|svg|webp|jpg|txt|webmanifest)$).*)'],
};
