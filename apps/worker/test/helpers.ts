// Test harness: a disposable database with pg-boss, a settable clock, an in-memory object store and a
// scripted fake Ad Library behind RunSession.
import { DEFAULT_SETTINGS, type Settings } from '@ideas-hub/core';
import { createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase } from '@ideas-hub/db/testing';
import { type SearchPage, TransientError } from '@ideas-hub/fb-ad-library';
import { sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { type Ctx } from '../src/context';
import { createQueues } from '../src/queues';
import { type RunDeps, type RunSession } from '../src/run';

export const S = DEFAULT_SETTINGS as unknown as Settings;

export class FakeClock {
  constructor(public t: number) {}
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

export interface Harness extends Ctx {
  clock: FakeClock;
  objects: Map<string, { body: Buffer; contentType: string }>;
  url: string;
  close(): Promise<void>;
}

export async function harness(start = '2026-10-21T06:00:00Z'): Promise<Harness> {
  const { url, drop } = await createTestDatabase();
  const pool = createPool(url, 6);
  const boss = new PgBoss({ connectionString: url, supervise: false, schedule: false });
  await boss.start();
  await createQueues(boss, S);
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const clock = new FakeClock(Date.parse(start));
  return {
    pool,
    db: createDb(pool),
    boss,
    clock,
    objects,
    url,
    store: { put: async (key, body, contentType) => void objects.set(key, { body, contentType }), delete: async (key) => void objects.delete(key) },
    log: () => {},
    async close() {
      await boss.stop({ graceful: false });
      await pool.end();
      await drop();
    },
  };
}

export async function setSettings(h: Ctx, over: Partial<Settings>) {
  for (const [key, value] of Object.entries(over)) {
    await h.db.execute(sql`insert into settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
      on conflict (key) do update set value = excluded.value`);
  }
}

/** Seed keywords `kw_0`… with texts `k0`…, created in order. */
export async function seedKeywords(h: Ctx, n: number) {
  for (let i = 0; i < n; i++) {
    await h.db.execute(sql`insert into keywords (id, text, origin, created_at) values (${`kw_${i}`}, ${`k${i}`}, 'seed', ${new Date(Date.UTC(2026, 0, 1, 0, 0, i))})`);
  }
}

// ---- fake Ad Library ----------------------------------------------------------------------------

const adObj = (id: string, domain = `shop-${id}.com`) => ({
  ad_archive_id: id,
  page_id: `page_${id}`,
  page_name: `Page ${id}`,
  start_date: 1785308400,
  end_date: 1792393200,
  is_active: true,
  snapshot: { body: { text: `caption ${id}` }, link_url: `https://www.${domain}/p`, display_format: 'IMAGE', images: [{ resized_image_url: `https://cdn.test/${id}.jpg` }] },
});
const conn = (ids: string[], hasNext: boolean, count?: number, domain?: (id: string) => string) => ({
  search_results_connection: {
    ...(count === undefined ? {} : { count }),
    edges: [{ node: { collated_results: ids.map((id) => adObj(id, domain?.(id))) } }],
    page_info: { has_next_page: hasNext },
  },
});

/** What one search of the fake site returns, per attempt. */
export type Script =
  | { kind: 'ok'; ids: string[]; pages?: string[][]; domain?: (id: string) => string }
  | { kind: 'no_results' }
  | { kind: 'empty_embedded' }
  | { kind: 'captcha' }
  | { kind: 'login_wall' }
  | { kind: 'timeout' }
  | { kind: 'parse' }
  | { kind: 'empty_scrolls'; ids: string[] }
  | { kind: 'two_page'; ids: string[] }
  | { kind: 'hang'; onOpen: () => void };

export function fakeSite(script: (query: string, country: string, attempt: number) => Script) {
  const attempts = new Map<string, number>();
  const calls: { query: string; country: string }[] = [];
  const page = (): SearchPage => {
    let current: Script = { kind: 'no_results' };
    let pages: string[][] = [];
    return {
      async open(url) {
        const u = new URL(url);
        const q = u.searchParams.get('q')!;
        const c = u.searchParams.get('country')!;
        const key = `${q}|${c}`;
        const n = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, n);
        calls.push({ query: q, country: c });
        current = script(q, c, n);
        if (current.kind === 'timeout') throw new TransientError('pageLoad', 'Timeout 60000ms exceeded');
        if (current.kind === 'hang') current.onOpen();
        pages = current.kind === 'ok' ? [...(current.pages ?? [])] : current.kind === 'two_page' ? [current.ids.slice(0, 10), current.ids.slice(0, 10)] : current.kind === 'empty_scrolls' ? [[], [], []] : [];
      },
      async embeddedData() {
        const c = current;
        if (c.kind === 'parse') return '{"data":';
        if (c.kind === 'no_results') return JSON.stringify({ data: conn([], false, 0) });
        if (c.kind === 'empty_embedded') return JSON.stringify({ data: conn([], true, 50001) });
        if (c.kind === 'captcha') return JSON.stringify({ data: { ...conn(['c1'], true, 50001), xfb_ad_library_is_captcha_required: true } });
        if (c.kind === 'ok') return JSON.stringify({ data: conn(c.ids, (c.pages ?? []).length > 0, 50001, c.domain) });
        if (c.kind === 'empty_scrolls' || c.kind === 'two_page') return JSON.stringify({ data: conn(c.ids, true, 50001) });
        return JSON.stringify({ data: conn(['x'], false, 1) });
      },
      async loginWall() {
        return current.kind === 'login_wall';
      },
      async scroll() {
        const next = pages.shift();
        if (!next) return null;
        const last = pages.length === 0 && current.kind === 'ok';
        return [JSON.stringify({ data: { ad_library_main: conn(next, !last && next.length > 0) } })];
      },
    };
  };
  const session = (startFails = false): RunSession => {
    let p: SearchPage | null = null;
    return {
      async start() {
        if (startFails) throw new Error('browserType.launchServer: Timeout 60000ms exceeded');
        p = page();
      },
      async page() {
        p ??= page();
        return p;
      },
      async restart() {
        p = page();
      },
      async close() {},
    };
  };
  return { calls, session };
}

/** A tiny real JPEG, PNG and WebP for thumbnail tests. */
export async function images() {
  const base = sharp({ create: { width: 4, height: 4, channels: 3, background: '#c2369b' } });
  return { jpg: await base.clone().jpeg().toBuffer(), png: await base.clone().png().toBuffer(), webp: await base.clone().webp().toBuffer() };
}

export function runDeps(h: Harness, site: ReturnType<typeof fakeSite>, over: Partial<RunDeps> & { startFails?: boolean } = {}): RunDeps {
  return {
    createSession: () => site.session(over.startFails),
    // Waits advance the fake clock at once.
    sleep: async (ms) => h.clock.advance(ms),
    random: () => 0.5,
    fetch: (async () => new Response(new Uint8Array((await images()).jpg), { status: 200 })) as unknown as typeof fetch,
    ...over,
  };
}

/** Inserts a run row as the scheduler or Run now would, without a job. */
export async function insertRun(
  h: Ctx,
  r: { id?: string; trigger?: 'schedule' | 'manual' | 'cli'; scheduledFor?: Date | null; deadline: Date; planned?: number; pairs?: { keywordId: string; country: string }[]; status?: string; jobId?: string | null },
) {
  const id = r.id ?? `run_${Math.random().toString(36).slice(2, 10)}`;
  const trigger = r.trigger ?? 'schedule';
  await h.db.execute(sql`
    insert into crawl_runs (id, source, trigger, scheduled_for, status, requested_pairs, planned_searches, deadline, job_id)
    values (${id}, 'fb_ad_library', ${trigger}, ${trigger === 'schedule' ? (r.scheduledFor ?? h.clock.now()) : null}, ${r.status ?? 'scheduled'},
      ${r.pairs ? JSON.stringify(r.pairs) : null}::jsonb, ${r.planned ?? 0}, ${r.deadline}, ${r.jobId ?? null})`);
  return id;
}

export async function one<T extends Record<string, unknown>>(h: Ctx, q: ReturnType<typeof sql>): Promise<T> {
  const { rows } = await h.db.execute(q);
  return rows[0] as T;
}

export async function all<T extends Record<string, unknown>>(h: Ctx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await h.db.execute(q)).rows as T[];
}
