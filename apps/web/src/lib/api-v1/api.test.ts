// /api/v1 against a disposable database: token authentication, scopes, store scoping, hidden AI sections,
// pagination, errors and rate limits (contract `ideas-hub-v1.md` section 3). The handlers are the ones the route files call.
import { type Db, createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBriefing, getBriefings, getIdea, getIdeaImage, getIdeas, getLatestBriefing, getMe, getStoreFunnel, getStores, getUnknown } from './handlers';
import { type V1Deps } from './pipeline';
import { type RateLimiter, createRateLimiter } from './rate-limit';
import { generateToken, hashToken } from './token';

const BASE = 'http://localhost:3300';
const NOW = new Date('2026-10-23T03:00:00Z');
const DAY = 86_400_000;

const tdb = testDatabaseAvailable() ? await createTestDatabase() : null;

type Mint = { user: string; scopes?: string[]; storeIds?: string[] | null; expiresAt?: Date; revokedAt?: Date | null };

describe.skipIf(!tdb)('/api/v1', () => {
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  let limiter: RateLimiter;
  const logged: unknown[] = [];
  const q = (text: string, values: unknown[] = []) => pool.query(text, values);
  const objects = {
    async getObject(key: string) {
      return key === 'ideas/with-image.webp' ? { body: new Blob(['webp-bytes']).stream(), contentType: 'image/webp', contentLength: 10 } : null;
    },
  };
  const deps = (): V1Deps => ({ db, now: () => NOW, limiter, objects, logError: (_id, e) => void logged.push(e) });

  /** Inserts a token for `user` and returns the raw value, as the Tokens page would show it once. */
  async function mint(o: Mint): Promise<string> {
    const token = generateToken();
    await q(
      `insert into api_tokens (id, user_id, name, token_hash, scopes, store_ids, expires_at, created_at, revoked_at)
       values ($1, $2, 'test', $3, $4, $5, $6, $7, $8)`,
      [
        `tok_${Math.random().toString(36).slice(2)}`,
        o.user,
        hashToken(token),
        o.scopes ?? ['briefings:read', 'ideas:read'],
        o.storeIds ?? null,
        o.expiresAt ?? new Date(NOW.getTime() + 90 * DAY),
        new Date(NOW.getTime() - DAY),
        o.revokedAt ?? null,
      ],
    );
    return token;
  }

  const req = (path: string, token?: string, headers: Record<string, string> = {}) =>
    new Request(`${BASE}/api/v1${path}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  const json = async (res: Response) => (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = (body: { data: { id: string }[] }) => body.data.map((x) => x.id);

  beforeAll(async () => {
    vi.stubEnv('THUMB_URL_SECRET', 'api-test-secret');
    vi.stubEnv('APP_URL', BASE);
    pool = createPool(tdb!.url);
    db = createDb(pool);
    for (const [id, role, disabled] of [
      ['user_admin', 'admin', false],
      ['user_a', 'member', false], // view on A
      ['user_b', 'member', false], // save on B (implies view)
      ['user_none', 'member', false],
      ['user_off', 'member', true],
    ] as const) {
      await q(`insert into users (id, email, name, role, disabled) values ($1, $2, $1, $3, $4)`, [id, `${id}@t.local`, role, disabled]);
    }
    await q(`insert into stores (id, name, erp_store_code, pod_studio_store_id) values ('store_A', 'Store A', 'ERP-A', 'pod-a'), ('store_B', 'Store B', null, null), ('store_C', 'Store C', null, null)`);
    await q(`insert into store_members (store_id, user_id, can_view) values ('store_A', 'user_a', true), ('store_C', 'user_off', true)`);
    await q(`insert into store_members (store_id, user_id, can_save) values ('store_B', 'user_b', true)`);

    await q(`insert into keywords (id, text, origin) values ('kw_seed', 'seed word', 'seed'), ('kw_a', 'word of a', 'store'), ('kw_b', 'word of b', 'store')`);
    await q(`insert into store_keywords (store_id, keyword_id) values ('store_A', 'kw_a'), ('store_B', 'kw_b')`);

    const sections = (tag: string) => ({
      sourceRun: { id: 'run_1', scheduledFor: '2026-10-20T18:00:00.000Z', runningAds: 40, okSearches: 9, plannedSearches: 10 },
      kpi: { runningAds: 40, delta: { change: 3, baselineDay: '2026-10-13', partial: false }, okRate: 0.9, nextHoliday: { date: '2026-11-26', name: 'Thanksgiving', days: 34 } },
      topAds: [{ adArchiveId: 'ad1', pageName: 'Shop', caption: 'cap', landingDomain: 'shop.example', thumbnailKey: 'ad1.webp', daysActive: 5, trendScore: 0.5, keyword: 'seed word', countries: ['US'] }],
      risingAds: [{ adArchiveId: 'ad2', pageName: null, caption: null, landingDomain: null, thumbnailKey: null, daysActive: null, trendScore: null, keyword: null, countries: [], sightings: 3, bestPosition: 2 }],
      hotKeywords: [{ key: 'kw_seed', label: 'seed word', runningAds: 10, delta: null }],
      risingShops: [{ key: 'shop.example', label: 'shop.example', runningAds: 4, delta: { change: 1, baselineDay: '2026-10-13', partial: true } }],
      news: { state: 'ok', summary: `summary ${tag}`, items: [{ id: 'news_1', title: 'T', link: 'https://n.example/a', publishedAt: '2026-10-20T10:00:00.000Z', feed: 'n.example' }], holidays: [{ date: '2026-11-26', name: 'Thanksgiving', days: 34 }] },
      suggestions: { state: 'ok', count: 1 },
    });
    const briefing = (id: string, date: string, scope: string, kw: string | null, ready: string | null, tag: string) =>
      q(`insert into briefings (id, date, scope, keyword_id, sections, ready_at) values ($1, $2, $3, $4, $5, $6)`, [id, date, scope, kw, JSON.stringify(sections(tag)), ready]);
    await briefing('brf_g1', '2026-10-20', 'global', null, '2026-10-20T00:40:00Z', 'g1');
    await briefing('brf_g2', '2026-10-21', 'global', null, '2026-10-21T00:40:00Z', 'g2');
    await briefing('brf_g3', '2026-10-22', 'global', null, null, 'g3');
    await briefing('brf_ka', '2026-10-21', 'keyword', 'kw_a', '2026-10-21T00:41:00Z', 'ka');
    await briefing('brf_kb', '2026-10-21', 'keyword', 'kw_b', '2026-10-21T00:42:00Z', 'kb');
    await briefing('brf_ks', '2026-10-21', 'keyword', 'kw_seed', '2026-10-21T00:43:00Z', 'ks');
    for (const b of ['brf_g1', 'brf_g2', 'brf_ka', 'brf_kb', 'brf_ks']) {
      await q(`insert into suggestions (id, briefing_id, kind, text, reason, evidence) values ($1, $2, 'idea', $3, 'because', '{"ads":["ad1"],"news":["news_1"]}')`, [`sug_${b}`, b, `suggestion of ${b}`]);
    }

    const idea = (id: string, store: string, updated: string, extra: { status?: string; source?: string; via?: string; image?: string; snapshot?: object; assignee?: string } = {}) =>
      q(
        `insert into saved_ideas (id, store_id, source, source_ref, via, title, tags, status, snapshot, image_key, assignee_id, created_by, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $1, '{x}', $6, $7, $8, $9, 'user_a', '2026-10-19T00:00:00Z', $10)`,
        [id, store, extra.source ?? 'ad', extra.image ? null : id, extra.via ?? 'ads', extra.status ?? 'new', JSON.stringify(extra.snapshot ?? { thumbnailKey: 'ad1.webp', keyword: 'seed word', trendScore: 0.4 }), extra.image ?? null, extra.assignee ?? null, updated],
      );
    await idea('idea_a1', 'store_A', '2026-10-20T01:00:00.000500Z');
    await idea('idea_a2', 'store_A', '2026-10-20T01:00:00.000100Z'); // same millisecond as a1
    await idea('idea_a3', 'store_A', '2026-10-20T02:00:00Z', { status: 'picked', via: 'briefing', assignee: 'user_b' });
    await idea('idea_a4', 'store_A', '2026-10-20T03:00:00Z', { source: 'manual', via: 'manual', image: 'ideas/with-image.webp', snapshot: {} });
    await idea('idea_a5', 'store_A', '2026-10-20T04:00:00Z');
    await idea('idea_b1', 'store_B', '2026-10-20T05:00:00Z');
    await idea('idea_b2', 'store_B', '2026-10-20T06:00:00Z');
    await idea('idea_c1', 'store_C', '2026-10-20T07:00:00Z');
  });

  beforeEach(() => {
    limiter = createRateLimiter();
    logged.length = 0;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
    await tdb?.drop();
  });

  describe('token authentication', () => {
    it('accepts a valid token, records last_used_at and sets the response headers', async () => {
      const token = await mint({ user: 'user_a' });
      const res = await getMe(req('/me', token), deps());
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-request-id')).toMatch(/^req_/);
      expect([res.headers.get('ratelimit-limit'), res.headers.get('ratelimit-remaining'), res.headers.get('ratelimit-reset')]).toEqual(['60', '59', '60']);
      const body = await json(res);
      expect(body.data).toMatchObject({ email: 'user_a@t.local', role: 'member', scopes: ['briefings:read', 'ideas:read'], expires_at: new Date(NOW.getTime() + 90 * DAY).toISOString() });
      expect(body.data.stores).toEqual([{ id: 'store_A', name: 'Store A', erp_store_code: 'ERP-A', pod_studio_store_id: 'pod-a' }]);
      const { rows } = await q(`select last_used_at from api_tokens where token_hash = $1`, [hashToken(token)]);
      expect(rows[0].last_used_at).toEqual(NOW);
    });

    it.each([
      ['no Authorization header', undefined],
      ['an unknown token', 'ihp_' + 'a'.repeat(40)],
      ['a malformed token', 'not-a-token'],
    ])('answers 401 unauthorized for %s, in the error shape', async (_name, token) => {
      const res = await getMe(req('/me', token), deps());
      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.error).toMatchObject({ code: 'unauthorized', request_id: res.headers.get('x-request-id') });
      expect(typeof body.error.message).toBe('string');
      // Every response carries the limit headers, a 401 included.
      expect(res.headers.get('ratelimit-limit')).toBe('600');
    });

    it('refuses an expired, a revoked and a disabled owner’s token with the same 401', async () => {
      const expired = await mint({ user: 'user_a', expiresAt: new Date(NOW.getTime() - 1000) });
      const revoked = await mint({ user: 'user_a', revokedAt: new Date(NOW.getTime() - 1000) });
      const disabled = await mint({ user: 'user_off' });
      const bodies = [];
      for (const token of [expired, revoked, disabled]) {
        const res = await getMe(req('/me', token), deps());
        expect(res.status).toBe(401);
        bodies.push((await json(res)).error.message);
      }
      expect(new Set(bodies).size).toBe(1);
    });

    it('reads the owner at request time: a revoked store tick removes the store from the token at once', async () => {
      const token = await mint({ user: 'user_b' });
      expect(ids(await json(await getIdeas(req('/ideas', token), deps())))).toEqual(['idea_b2', 'idea_b1']);
      await q(`delete from store_members where user_id = 'user_b'`);
      try {
        expect(ids(await json(await getIdeas(req('/ideas', token), deps())))).toEqual([]);
        expect((await json(await getMe(req('/me', token), deps()))).data.stores).toEqual([]);
      } finally {
        await q(`insert into store_members (store_id, user_id, can_save) values ('store_B', 'user_b', true)`);
      }
    });

    it('never accepts a session cookie or a token in the query string', async () => {
      const token = await mint({ user: 'user_a' });
      expect((await getMe(req('/me', undefined, { cookie: 'better-auth.session_token=anything' }), deps())).status).toBe(401);
      expect((await getMe(new Request(`${BASE}/api/v1/me?token=${token}&access_token=${token}`), deps())).status).toBe(401);
      expect((await getMe(req('/me', undefined, { authorization: `Basic ${token}` }), deps())).status).toBe(401);
    });

    it('stores only the hash', async () => {
      const token = await mint({ user: 'user_a' });
      const { rows } = await q(`select token_hash from api_tokens where token_hash = $1`, [hashToken(token)]);
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect((await q(`select 1 from api_tokens where token_hash = $1`, [token])).rowCount).toBe(0);
    });
  });

  describe('scopes', () => {
    it('answers 403 insufficient_scope outside the token’s scopes and allows /me and /stores for any scope', async () => {
      const briefingsOnly = await mint({ user: 'user_admin', scopes: ['briefings:read'] });
      const ideasOnly = await mint({ user: 'user_admin', scopes: ['ideas:read'] });
      for (const [handler, path, token] of [
        [getIdeas, '/ideas', briefingsOnly],
        [getBriefings, '/briefings', ideasOnly],
        [getLatestBriefing, '/briefings/latest', ideasOnly],
      ] as const) {
        const res = await handler(req(path, token), deps());
        expect([res.status, (await json(res)).error.code]).toEqual([403, 'insufficient_scope']);
      }
      const idRoutes = [
        [getIdea, 'idea_a1', briefingsOnly],
        [getIdeaImage, 'idea_a4', briefingsOnly],
        [getBriefing, 'brf_g1', ideasOnly],
      ] as const;
      for (const [handler, id, token] of idRoutes) expect((await handler(req(`/x/${id}`, token), deps(), id)).status).toBe(403);
      expect((await getStoreFunnel(req('/stores/store_A/funnel', briefingsOnly), deps(), 'store_A')).status).toBe(403);
      for (const token of [briefingsOnly, ideasOnly]) {
        expect((await getMe(req('/me', token), deps())).status).toBe(200);
        expect((await getStores(req('/stores', token), deps())).status).toBe(200);
      }
    });

    it('answers unknown paths in the error shape, after the token check', async () => {
      const token = await mint({ user: 'user_a' });
      const res = await getUnknown(req('/nope', token), deps());
      expect([res.status, (await json(res)).error.code]).toEqual([404, 'not_found']);
      expect((await getUnknown(req('/nope'), deps())).status).toBe(401);
    });
  });

  describe('store scoping', () => {
    it('a member sees the stores and ideas of the stores they can view, an admin all', async () => {
      const member = await mint({ user: 'user_a' });
      const admin = await mint({ user: 'user_admin' });
      expect(ids(await json(await getStores(req('/stores', member), deps())))).toEqual(['store_A']);
      expect(ids(await json(await getStores(req('/stores', admin), deps())))).toEqual(['store_A', 'store_B', 'store_C']);
      const own = await json(await getIdeas(req('/ideas', member), deps()));
      expect(new Set(own.data.map((i: { store_id: string }) => i.store_id))).toEqual(new Set(['store_A']));
      expect(ids(await json(await getIdeas(req('/ideas?limit=200', admin), deps())))).toHaveLength(8);
      // `save` alone implies view.
      expect(ids(await json(await getIdeas(req('/ideas', await mint({ user: 'user_b' })), deps())))).toEqual(['idea_b2', 'idea_b1']);
      expect(ids(await json(await getIdeas(req('/ideas', await mint({ user: 'user_none' })), deps())))).toEqual([]);
    });

    it('a store list narrows the owner and never widens it', async () => {
      const adminOnB = await mint({ user: 'user_admin', storeIds: ['store_B'] });
      expect(ids(await json(await getStores(req('/stores', adminOnB), deps())))).toEqual(['store_B']);
      expect(ids(await json(await getIdeas(req('/ideas', adminOnB), deps())))).toEqual(['idea_b2', 'idea_b1']);
      // user_a has a tick on A only: listing B too changes nothing.
      const memberAB = await mint({ user: 'user_a', storeIds: ['store_A', 'store_B'] });
      expect(ids(await json(await getStores(req('/stores', memberAB), deps())))).toEqual(['store_A']);
      const memberB = await mint({ user: 'user_a', storeIds: ['store_B'] });
      expect(ids(await json(await getIdeas(req('/ideas', memberB), deps())))).toEqual([]);
    });

    it('answers 404 for an idea, an image and a store filter outside the token’s stores, as for an unknown id', async () => {
      const member = await mint({ user: 'user_a' });
      const outside = await getIdea(req('/ideas/idea_b1', member), deps(), 'idea_b1');
      const unknown = await getIdea(req('/ideas/idea_zzz', member), deps(), 'idea_zzz');
      expect([outside.status, unknown.status]).toEqual([404, 404]);
      const [outsideBody, unknownBody] = [await json(outside), await json(unknown)];
      expect(outsideBody.error.code).toBe('not_found');
      expect(outsideBody.error.message).toBe(unknownBody.error.message);
      expect((await getIdeaImage(req('/x', member), deps(), 'idea_b1')).status).toBe(404);
      const filtered = await getIdeas(req('/ideas?store_id=store_B', member), deps());
      expect([filtered.status, (await json(filtered)).error.code]).toEqual([404, 'not_found']);
      // Narrowed admin: a store outside the list is out of scope too.
      const adminOnA = await mint({ user: 'user_admin', storeIds: ['store_A'] });
      expect((await getIdea(req('/x', adminOnA), deps(), 'idea_b1')).status).toBe(404);
      expect((await getIdea(req('/x', adminOnA), deps(), 'idea_a1')).status).toBe(200);
    });

    it('answers the funnel of a store the token can view, and 404 for any other store as for an unknown one', async () => {
      await q(`update saved_ideas set picked_at = created_at, done_at = created_at + interval '36 hours' where id in ('idea_a1', 'idea_a2')`);
      await q(`update saved_ideas set picked_at = created_at where id = 'idea_a3'`);
      const member = await mint({ user: 'user_a' });
      const res = await getStoreFunnel(req('/stores/store_A/funnel', member), deps(), 'store_A');
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.data).toMatchObject({ store_id: 'store_A', time_zone: 'Asia/Ho_Chi_Minh' });
      expect(body.data.weeks).toHaveLength(8);
      expect(body.data.weeks[0]).toEqual({ week_start: '2026-10-19', saved: 5, picked: 3, done: 2, median_days_to_done: 1.5 });
      expect(body.data.weeks[1]).toEqual({ week_start: '2026-10-12', saved: 0, picked: 0, done: 0, median_days_to_done: null });
      const [outside, unknown, none] = [
        await getStoreFunnel(req('/stores/store_B/funnel', member), deps(), 'store_B'),
        await getStoreFunnel(req('/stores/store_zzz/funnel', member), deps(), 'store_zzz'),
        await getStoreFunnel(req('/stores/store_A/funnel', await mint({ user: 'user_none' })), deps(), 'store_A'),
      ];
      expect([outside.status, unknown.status, none.status]).toEqual([404, 404, 404]);
      const [outsideBody, unknownBody] = [await json(outside), await json(unknown)];
      expect(outsideBody.error.code).toBe('not_found');
      expect(outsideBody.error.message).toBe(unknownBody.error.message);
      // An admin sees any store; a store list narrows the admin too.
      const admin = await mint({ user: 'user_admin' });
      expect((await getStoreFunnel(req('/stores/store_B/funnel', admin), deps(), 'store_B')).status).toBe(200);
      // A store that does not exist is 404 for an admin too, with the same message.
      const missing = await getStoreFunnel(req('/stores/store_zzz/funnel', admin), deps(), 'store_zzz');
      expect([missing.status, (await json(missing)).error.message]).toEqual([404, outsideBody.error.message]);
      const adminOnA = await mint({ user: 'user_admin', storeIds: ['store_A'] });
      expect((await getStoreFunnel(req('/stores/store_B/funnel', adminOnA), deps(), 'store_B')).status).toBe(404);
      expect((await getStoreFunnel(req('/stores/store_A/funnel', adminOnA), deps(), 'store_A')).status).toBe(200);
      await q(`update saved_ideas set picked_at = null, done_at = null where id in ('idea_a1', 'idea_a2', 'idea_a3')`);
    });

    it('serves an uploaded image as a private, uncached response and 404 when there is none', async () => {
      const member = await mint({ user: 'user_a' });
      const res = await getIdeaImage(req('/x', member), deps(), 'idea_a4');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(await res.text()).toBe('webp-bytes');
      const none = await getIdeaImage(req('/x', member), deps(), 'idea_a1');
      expect([none.status, (await json(none)).error.code]).toEqual([404, 'not_found']);
    });

    it('represents an idea in snake_case, with emails only and a signed absolute thumbnail URL', async () => {
      const member = await mint({ user: 'user_a' });
      const body = await json(await getIdea(req('/x', member), deps(), 'idea_a3'));
      expect(body.data).toMatchObject({
        id: 'idea_a3',
        store_id: 'store_A',
        status: 'picked',
        via: 'briefing',
        assignee_email: 'user_b@t.local',
        created_by_email: 'user_a@t.local',
        created_at: '2026-10-19T00:00:00.000Z',
        updated_at: '2026-10-20T02:00:00.000Z',
        has_image: false,
        tags: ['x'],
        url: `${BASE}/ideas/idea_a3`,
      });
      expect(body.data.snapshot.thumbnail_url).toMatch(new RegExp(`^${BASE}/thumbs/[0-9a-f]{64}/ad1\\.webp$`));
      expect(body.data.snapshot).toMatchObject({ keyword: 'seed word', trend_score: 0.4, caption: null, link: null });
      expect(JSON.stringify(body)).not.toMatch(/user_a"|user_b"|"created_by"|"assignee_id"/);
      expect((await json(await getIdea(req('/x', member), deps(), 'idea_a4'))).data.has_image).toBe(true);
    });
  });

  describe('briefings', () => {
    it('lists ready briefings newest first, filters them, and returns the latest ready global one', async () => {
      const token = await mint({ user: 'user_none' });
      const all = await json(await getBriefings(req('/briefings', token), deps()));
      expect(ids(all)).toEqual(['brf_ks', 'brf_kb', 'brf_ka', 'brf_g2', 'brf_g1']);
      expect(all.next_cursor).toBeNull();
      expect(all.data[0]).toEqual({ id: 'brf_ks', date: '2026-10-21', scope: 'keyword', keyword: { id: 'kw_seed', text: 'seed word' }, ready_at: '2026-10-21T00:43:00.000Z' });
      expect(ids(await json(await getBriefings(req('/briefings?scope=global', token), deps())))).toEqual(['brf_g2', 'brf_g1']);
      expect(ids(await json(await getBriefings(req('/briefings?keyword_id=kw_a', token), deps())))).toEqual(['brf_ka']);
      expect(ids(await json(await getBriefings(req('/briefings?date_from=2026-10-21&date_to=2026-10-21&scope=global', token), deps())))).toEqual(['brf_g2']);
      const latest = await json(await getLatestBriefing(req('/briefings/latest', token), deps()));
      expect(latest.data).toMatchObject({ id: 'brf_g2', date: '2026-10-21', scope: 'global', keyword: null, ready_at: '2026-10-21T00:40:00.000Z' });
    });

    it('maps the stored sections field by field', async () => {
      const token = await mint({ user: 'user_none' });
      const { data } = await json(await getBriefing(req('/x', token), deps(), 'brf_g2'));
      expect(data.source_run).toEqual({ id: 'run_1', scheduled_for: '2026-10-20T18:00:00.000Z', running_ads: 40, ok_searches: 9, planned_searches: 10 });
      expect(data.kpi).toEqual({
        running_ads: 40,
        delta: { change: 3, baseline_day: '2026-10-13', partial: false },
        ok_rate: 0.9,
        next_holiday: { date: '2026-11-26', name: 'Thanksgiving', days: 34 },
      });
      expect(data.top_ads[0]).toMatchObject({
        ad_archive_id: 'ad1',
        ad_library_url: 'https://www.facebook.com/ads/library/?id=ad1',
        landing_domain: 'shop.example',
        days_active: 5,
        trend_score: 0.5,
        countries: ['US'],
      });
      expect(data.top_ads[0].thumbnail_url).toMatch(new RegExp(`^${BASE}/thumbs/`));
      expect(data.rising_ads[0]).toMatchObject({ thumbnail_url: null, sightings: 3, best_position: 2 });
      expect(data.hot_keywords).toEqual([{ key: 'kw_seed', label: 'seed word', running_ads: 10, delta: null }]);
      expect(data.rising_shops[0].delta).toEqual({ change: 1, baseline_day: '2026-10-13', partial: true });
      expect(data.news).toMatchObject({ state: 'ok', summary: 'summary g2', items: [{ id: 'news_1', published_at: '2026-10-20T10:00:00.000Z', feed: 'n.example' }] });
      expect(data.suggestions).toEqual({ state: 'ok', items: [{ id: 'sug_brf_g2', kind: 'idea', text: 'suggestion of brf_g2', reason: 'because', evidence: { ads: ['ad1'], news: ['news_1'] } }] });
    });

    it('answers 404 for a briefing that is still building, and for an unknown one', async () => {
      const token = await mint({ user: 'user_none' });
      expect((await getBriefing(req('/x', token), deps(), 'brf_g3')).status).toBe(404);
      expect((await getBriefing(req('/x', token), deps(), 'brf_zzz')).status).toBe(404);
    });

    it('hides the AI sections of a keyword briefing from a token without a view on a store that tracks it', async () => {
      const get = async (token: string, id: string) => (await json(await getBriefing(req('/x', token), deps(), id))).data;
      const memberA = await mint({ user: 'user_a' }); // view on A: tracks kw_a only
      const admin = await mint({ user: 'user_admin' });
      const adminOnA = await mint({ user: 'user_admin', storeIds: ['store_A'] });

      // kw_b is tracked by B only.
      const hidden = await get(memberA, 'brf_kb');
      expect([hidden.news, hidden.suggestions]).toEqual([{ state: 'hidden' }, { state: 'hidden' }]);
      expect(JSON.stringify(hidden)).not.toContain('suggestion of brf_kb');
      expect(JSON.stringify(hidden)).not.toContain('summary kb');
      // Sections 1-4 stay shared.
      expect(hidden.top_ads).toHaveLength(1);
      expect(hidden.kpi.running_ads).toBe(40);

      expect((await get(memberA, 'brf_ka')).suggestions.state).toBe('ok');
      expect((await get(memberA, 'brf_ks')).suggestions.state).toBe('ok'); // seed keyword: everyone
      expect((await get(memberA, 'brf_g2')).suggestions.state).toBe('ok'); // global briefing: everyone
      expect((await get(admin, 'brf_kb')).suggestions.state).toBe('ok');
      // An admin token narrowed to A follows the list, like a member.
      expect((await get(adminOnA, 'brf_kb')).suggestions).toEqual({ state: 'hidden' });
      expect((await get(adminOnA, 'brf_ka')).suggestions.state).toBe('ok');
      // A token whose store list leaves out the tracking store hides it as well.
      const memberAB = await mint({ user: 'user_a', storeIds: ['store_B'] });
      expect((await get(memberAB, 'brf_ka')).suggestions).toEqual({ state: 'hidden' });
    });

    it('never says which store tracks a keyword, to a member or an admin', async () => {
      for (const user of ['user_a', 'user_admin']) {
        const token = await mint({ user });
        const bodies = [
          await json(await getBriefings(req('/briefings', token), deps())),
          await json(await getBriefing(req('/x', token), deps(), 'brf_ka')),
          await json(await getBriefing(req('/x', token), deps(), 'brf_kb')),
          await json(await getLatestBriefing(req('/briefings/latest', token), deps())),
        ];
        const text = JSON.stringify(bodies);
        expect(text).not.toMatch(/store_[ABC]|tracked|"store/i);
        expect(text).toContain('word of b'); // keyword text is shared
      }
    });

    it('keeps a skipped AI section as its state and reason, with news items still present', async () => {
      await q(`update briefings set sections = sections || '{"news": {"state": "skipped", "reason": "cost_cap", "items": [], "holidays": []}, "suggestions": {"state": "failed", "reason": "ai"}}'::jsonb where id = 'brf_g1'`);
      const token = await mint({ user: 'user_none' });
      const { data } = await json(await getBriefing(req('/x', token), deps(), 'brf_g1'));
      expect(data.news).toEqual({ state: 'skipped', reason: 'cost_cap', items: [], holidays: [] });
      expect(data.suggestions).toEqual({ state: 'failed', reason: 'ai' });
    });
  });

  describe('pagination and parameters', () => {
    it('pages ideas by (updated_at, id) descending without gaps or repeats, including rows within one millisecond', async () => {
      const token = await mint({ user: 'user_a' });
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await getIdeas(req(`/ideas?limit=2${cursor ? `&cursor=${cursor}` : ''}`, token), deps());
        const body = await json(res);
        seen.push(...ids(body));
        cursor = body.next_cursor;
        pages++;
      } while (cursor);
      expect(seen).toEqual(['idea_a5', 'idea_a4', 'idea_a3', 'idea_a1', 'idea_a2']);
      expect(pages).toBe(3);
    });

    it('returns next_cursor null on the last page and applies the filters', async () => {
      const token = await mint({ user: 'user_admin' });
      const picked = await json(await getIdeas(req('/ideas?status=picked&store_id=store_A', token), deps()));
      expect([ids(picked), picked.next_cursor]).toEqual([['idea_a3'], null]);
      expect(ids(await json(await getIdeas(req('/ideas?via=manual', token), deps())))).toEqual(['idea_a4']);
      expect(ids(await json(await getIdeas(req('/ideas?source=manual', token), deps())))).toEqual(['idea_a4']);
      expect(ids(await json(await getIdeas(req('/ideas?updated_since=2026-10-20T06:00:00Z', token), deps())))).toEqual(['idea_c1', 'idea_b2']);
    });

    it('pages /stores and /briefings too', async () => {
      const token = await mint({ user: 'user_admin' });
      const first = await json(await getStores(req('/stores?limit=2', token), deps()));
      expect(ids(first)).toEqual(['store_A', 'store_B']);
      expect(ids(await json(await getStores(req(`/stores?limit=2&cursor=${first.next_cursor}`, token), deps())))).toEqual(['store_C']);
      const b1 = await json(await getBriefings(req('/briefings?limit=3', token), deps()));
      const b2 = await json(await getBriefings(req(`/briefings?limit=3&cursor=${b1.next_cursor}`, token), deps()));
      expect([...ids(b1), ...ids(b2)]).toEqual(['brf_ks', 'brf_kb', 'brf_ka', 'brf_g2', 'brf_g1']);
      expect(b2.next_cursor).toBeNull();
    });

    it('refuses a cursor of another query, a forged one and a bad parameter', async () => {
      const token = await mint({ user: 'user_admin' });
      const page = await json(await getIdeas(req('/ideas?limit=1', token), deps()));
      for (const path of [
        `/ideas?limit=1&status=picked&cursor=${page.next_cursor}`,
        '/ideas?cursor=not-base64-json',
        `/ideas?cursor=${Buffer.from('{"k":["x","y"],"f":"0"}').toString('base64url')}`,
      ]) {
        const res = await getIdeas(req(path, token), deps());
        expect([res.status, (await json(res)).error.code]).toEqual([400, 'invalid_cursor']);
      }
      // A cursor of /ideas is not one of /briefings.
      expect((await getBriefings(req(`/briefings?cursor=${page.next_cursor}`, token), deps())).status).toBe(400);
      for (const path of ['/ideas?limit=0', '/ideas?limit=201', '/ideas?limit=abc', '/ideas?status=archived', '/ideas?via=x', '/ideas?updated_since=yesterday', '/ideas?store_id=']) {
        const res = await getIdeas(req(path, token), deps());
        expect([res.status, (await json(res)).error.code]).toEqual([400, 'invalid_request']);
      }
      for (const path of ['/briefings?scope=all', '/briefings?date_from=2026-13-01', '/briefings?date_to=21/10/2026']) {
        expect((await getBriefings(req(path, token), deps())).status).toBe(400);
      }
    });
  });

  describe('errors and rate limits', () => {
    it('answers 500 internal with a request id and logs the failure, not the request', async () => {
      const token = await mint({ user: 'user_a' });
      // Signing a thumbnail URL needs the secret: without it the response cannot be built.
      vi.stubEnv('THUMB_URL_SECRET', '');
      try {
        const res = await getIdea(req('/x', token), deps(), 'idea_a3');
        const body = await json(res);
        expect([res.status, body.error.code, body.error.request_id]).toEqual([500, 'internal', res.headers.get('x-request-id')]);
        expect(JSON.stringify(body)).not.toContain('THUMB_URL_SECRET');
        expect(logged).toHaveLength(1);
      } finally {
        vi.stubEnv('THUMB_URL_SECRET', 'api-test-secret');
      }
    });

    it('limits a token to 60 requests a minute, with the headers, and answers 429 with Retry-After', async () => {
      const token = await mint({ user: 'user_a' });
      const other = await mint({ user: 'user_a' });
      for (let i = 0; i < 60; i++) expect((await getMe(req('/me', token), deps())).status).toBe(200);
      const res = await getMe(req('/me', token), deps());
      expect(res.status).toBe(429);
      expect((await json(res)).error.code).toBe('rate_limited');
      expect([res.headers.get('ratelimit-limit'), res.headers.get('ratelimit-remaining'), res.headers.get('retry-after')]).toEqual(['60', '0', '60']);
      // Another token has its own count.
      expect((await getMe(req('/me', other), deps())).status).toBe(200);
    });

    it('limits the install across tokens', async () => {
      limiter = createRateLimiter({ perToken: 5, perInstall: 8 });
      const a = await mint({ user: 'user_a' });
      const b = await mint({ user: 'user_b' });
      const statuses: number[] = [];
      for (const token of [a, a, a, a, b, b, b, b, b, b]) statuses.push((await getMe(req('/me', token), deps())).status);
      expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 429, 429]);
    });
  });
});
