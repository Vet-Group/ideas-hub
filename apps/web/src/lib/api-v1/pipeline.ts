// The common path of every /api/v1 request (contract `ideas-hub-v1.md` §3): bearer-token authentication,
// the per-token and per-install rate limits, the scope check, the error shape and the response headers.
// Only the Authorization header is read, never a cookie, so a browser page cannot call the API cross-site.
import { timingSafeEqual } from 'node:crypto';
import { type Role, type StoreScope, type Viewer, narrowViewer, storeScope } from '@ideas-hub/core';
import { type TokenScope, apiTokens, storeMembers, users } from '@ideas-hub/db';
import { type Db } from '@ideas-hub/db/client';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { ObjectStore } from '@/lib/object-store';
import { ApiError } from './error';
import { type RateLimiter, type RateState } from './rate-limit';
import { TOKEN_PATTERN, hashToken } from './token';

export interface V1Deps {
  db: Db;
  now: () => Date;
  limiter: RateLimiter;
  objects: Pick<ObjectStore, 'getObject'>;
  /** Server-side log of an unexpected failure; the client only gets the request id. */
  logError: (requestId: string, error: unknown) => void;
}

export interface V1Ctx {
  req: Request;
  url: URL;
  deps: V1Deps;
  requestId: string;
  /** The public origin, for absolute links in the representation. */
  baseUrl: string;
  token: { id: string; scopes: readonly string[]; storeIds: readonly string[] | null; expiresAt: Date };
  owner: { email: string; role: Role };
  /** The owner narrowed to the token's store list. */
  viewer: Viewer;
  scope: StoreScope;
}

const LAST_USED_EVERY_MS = 60_000;

async function authenticate(req: Request, deps: V1Deps) {
  const unauthorized = () => new ApiError(401, 'unauthorized', 'Missing, invalid, expired or revoked token.');
  const match = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!match || !TOKEN_PATTERN.test(match[1]!)) throw unauthorized();
  const hash = hashToken(match[1]!);
  const [row] = await deps.db
    .select({
      id: apiTokens.id,
      hash: apiTokens.tokenHash,
      scopes: apiTokens.scopes,
      storeIds: apiTokens.storeIds,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      lastUsedAt: apiTokens.lastUsedAt,
      userId: users.id,
      email: users.email,
      role: users.role,
      disabled: users.disabled,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hash));
  const now = deps.now();
  // The lookup already matched on the hash; the constant-time comparison keeps the check independent of the index.
  if (!row || !timingSafeEqual(Buffer.from(row.hash, 'hex'), Buffer.from(hash, 'hex'))) throw unauthorized();
  if (row.revokedAt || row.expiresAt <= now || row.disabled) throw unauthorized();

  // The owner's role and ticks are read now, so a change applies to the token at once.
  const memberships = (await deps.db.select().from(storeMembers).where(eq(storeMembers.userId, row.userId))).map((m) => ({
    storeId: m.storeId,
    view: m.canView,
    save: m.canSave,
    keywords: m.canKeywords,
  }));
  const owner: Viewer = { userId: row.userId, role: row.role === 'admin' ? 'admin' : 'member', memberships };
  const viewer = row.storeIds ? narrowViewer(owner, row.storeIds) : owner;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
    await deps.db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(and(eq(apiTokens.id, row.id), or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, new Date(now.getTime() - LAST_USED_EVERY_MS)))));
  }
  return {
    token: { id: row.id, scopes: row.scopes, storeIds: row.storeIds, expiresAt: row.expiresAt },
    owner: { email: row.email, role: owner.role },
    viewer,
    scope: storeScope(viewer),
  };
}

function withHeaders(res: Response, requestId: string, rate: RateState): Response {
  const headers = new Headers(res.headers);
  headers.set('X-Request-Id', requestId);
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  headers.set('RateLimit-Limit', String(rate.limit));
  headers.set('RateLimit-Remaining', String(rate.remaining));
  headers.set('RateLimit-Reset', String(rate.resetSeconds));
  if (!rate.allowed) headers.set('Retry-After', String(rate.resetSeconds));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Runs `run` for an authenticated request holding `required` (null: any scope). */
export async function handleV1(req: Request, deps: V1Deps, required: TokenScope | null, run: (ctx: V1Ctx) => Promise<unknown>): Promise<Response> {
  const requestId = `req_${nanoid(10)}`;
  let rate: RateState | null = null;
  try {
    const auth = await authenticate(req, deps);
    rate = deps.limiter.take(auth.token.id, deps.now().getTime());
    if (!rate.allowed) throw new ApiError(429, 'rate_limited', 'Too many requests. Retry after the time in Retry-After.');
    if (required && !auth.token.scopes.includes(required)) throw new ApiError(403, 'insufficient_scope', `The token lacks the ${required} scope.`);
    const url = new URL(req.url);
    const baseUrl = (process.env.APP_URL || url.origin).replace(/\/+$/, '');
    const out = await run({ req, url, deps, requestId, baseUrl, ...auth });
    return withHeaders(out instanceof Response ? out : Response.json(out), requestId, rate);
  } catch (e) {
    let status = 500;
    let code = 'internal';
    let message = 'Internal error.';
    if (e instanceof ApiError) ({ status, code, message } = e);
    else deps.logError(requestId, e);
    // A request without a valid token only reports the install's counter; it consumes nothing.
    rate ??= deps.limiter.take(null, deps.now().getTime());
    return withHeaders(Response.json({ error: { code, message, request_id: requestId } }, { status }), requestId, rate);
  }
}
