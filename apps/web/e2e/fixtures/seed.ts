// Fixed e2e seed data (plan Step 5 harness): one fixture per special state. The database is dropped and
// migrated again before every e2e run, so the tests start from exactly this data.
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { hashPassword } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import sharp from 'sharp';
import { E2E_BUCKET, E2E_DB, E2E_FIXED_NOW, adminDatabaseUrl, e2eDatabaseUrl } from './env';

export const PASSWORD = 'e2e-password-123';
export const USERS = {
  admin: { id: 'user_e2e_admin', email: 'admin@e2e.test', name: 'Admin E2E', role: 'admin' },
  member: { id: 'user_e2e_member', email: 'member@e2e.test', name: 'Member E2E', role: 'member' },
  other: { id: 'user_e2e_other', email: 'other@e2e.test', name: 'Other E2E', role: 'member' },
  // Step 6: `save` on store A only; `view` only on store A; `keywords` on store A.
  saver: { id: 'user_e2e_saver', email: 'saver@e2e.test', name: 'Saver E2E', role: 'member' },
  viewer: { id: 'user_e2e_viewer', email: 'viewer@e2e.test', name: 'Viewer E2E', role: 'member' },
  kw: { id: 'user_e2e_kw', email: 'kw@e2e.test', name: 'Keywords E2E', role: 'member' },
} as const;
export const STORES = { a: { id: 'store_e2e_a', name: 'Store A' }, b: { id: 'store_e2e_b', name: 'Store B' } } as const;
/** Step 6 research data: a store-tracked keyword with 4 days of snapshots ("Less than 7 days"). */
export const MUG = { keywordId: 'kw_e2e_mug', keyword: 'dog mom mug', domain: 'dogmom.example' } as const;
/** A landing domain of the default nonShopDomains setting. */
export const NON_SHOP_DOMAIN = 'play.google.com';
/** Ads of MUG: thumbnails in MinIO except `missing` (a key without an object: the "Chưa có ảnh" tile). */
export const MUG_ADS = ['e2e_mug_1', 'e2e_mug_2', 'e2e_mug_3', 'e2e_mug_4', 'e2e_mug_5', 'e2e_mug_missing'] as const;
/** Step 7 briefings: today ready (all 6 sections), 20/10 with the AI sections failed, 19/10 skipped. */
export const BRIEFINGS = { today: 'brf_e2e_today', failed: 'brf_e2e_failed', skipped: 'brf_e2e_skipped', keyword: 'brf_e2e_kw' } as const;
export const SUGGESTIONS = { idea: 'sug_e2e_idea', keyword: 'sug_e2e_keyword', kwIdea: 'sug_e2e_kw_idea' } as const;
export const IDEAS = { fresh: 'idea_e2e_new', picked: 'idea_e2e_picked', done: 'idea_e2e_done', b: 'idea_e2e_b' } as const;

const NOW = new Date(E2E_FIXED_NOW);
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

export async function seedE2e(): Promise<void> {
  const admin = new pg.Client({ connectionString: adminDatabaseUrl() });
  await admin.connect();
  await admin.query(`drop database if exists ${E2E_DB} with (force)`);
  await admin.query(`create database ${E2E_DB}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: e2eDatabaseUrl(), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
    const q = (text: string, values: unknown[] = []) => pool.query(text, values);
    const hash = await hashPassword(PASSWORD);
    for (const u of Object.values(USERS)) {
      await q(`insert into users (id, email, name, role, email_verified) values ($1, $2, $3, $4, true)`, [u.id, u.email, u.name, u.role]);
      await q(`insert into accounts (id, user_id, account_id, provider_id, password) values ($1, $2, $2, 'credential', $3)`, [`acct_${u.id}`, u.id, hash]);
    }
    for (const s of Object.values(STORES)) await q(`insert into stores (id, name) values ($1, $2)`, [s.id, s.name]);
    // "other" has view on store B only; "member" starts with no store (the admin test adds store A).
    await q(`insert into store_members (store_id, user_id, can_view) values ($1, $2, true)`, [STORES.b.id, USERS.other.id]);

    // Run log: a finished scheduled run and a manual one triggered by the admin. created_at is fixed: the run
    // log shows it for a run without scheduled_for, and the wall clock would change the screenshot.
    await q(
      `insert into crawl_runs (id, source, trigger, scheduled_for, status, planned_searches, ok_searches, running_ads, started_at, finished_at, deadline, created_at)
       values ('run_e2e_sched', 'fb_ad_library', 'schedule', $1, 'done', 160, 158, 4210, $1, $2, $3, $1)`,
      [ago(7.5), ago(5), ago(3)],
    );
    await q(
      `insert into crawl_runs (id, source, trigger, triggered_by, status, planned_searches, ok_searches, running_ads, started_at, finished_at, deadline, requested_pairs, created_at)
       values ('run_e2e_manual', 'fb_ad_library', 'manual', $1, 'done', 2, 2, 120, $2, $3, $4, '[]'::jsonb, $2)`,
      [USERS.admin.id, ago(2), ago(1.9), ago(1)],
    );

    // Crawler attention: one open Alert, blocked_until in the past.
    await q(`insert into alerts (id, kind, run_id, detail, created_at) values ('alert_e2e_1', 'parse_error', 'run_e2e_sched', 'unexpected payload', $1)`, [ago(5)]);
    await q(`update crawler_state set blocked_until = $1 where id = 1`, [ago(1)]);

    // Ctrl+K data: % and _ in captions, one closer match.
    const ad = (id: string, caption: string, page: string, domain: string, lastSeen: string) =>
      q(
        `insert into ads (ad_archive_id, caption, page_name, landing_domain, first_seen_date, last_seen_date, parsed) values ($1, $2, $3, $4, '2026-10-01', $5, '{}'::jsonb)`,
        [id, caption, page, domain, lastSeen],
      );
    await ad('e2e_ad_pct', '50% off teacher shirt', 'Teach Co', 'teach.example', '2026-10-19');
    await ad('e2e_ad_plain', '50 off teacher shirt', 'Teach Two', 'teach2.example', '2026-10-20');
    await ad('e2e_ad_under', 'nurse_shirt bundle', 'Nurse Co', 'nurse.example', '2026-10-18');
    await ad('e2e_ad_exact', 'teacher shirt', 'Exact Shirts', 'exact.example', '2026-10-10');
    await q(`insert into keywords (id, text, origin) values ('kw_e2e_1', 'teacher shirt', 'seed'), ('kw_e2e_2', 'nurse shirt', 'seed')`);

    // Step 6: members with save, view or keywords on store A.
    await q(`insert into store_members (store_id, user_id, can_save) values ($1, $2, true)`, [STORES.a.id, USERS.saver.id]);
    await q(`insert into store_members (store_id, user_id, can_view) values ($1, $2, true)`, [STORES.a.id, USERS.viewer.id]);
    await q(`insert into store_members (store_id, user_id, can_keywords) values ($1, $2, true)`, [STORES.a.id, USERS.kw.id]);
    await q(`insert into keywords (id, text, origin) values ($1, $2, 'store')`, [MUG.keywordId, MUG.keyword]);
    await q(`insert into store_keywords (store_id, keyword_id) values ($1, $2)`, [STORES.a.id, MUG.keywordId]);
    // Snapshots for the two slots (01:00 = 18:00 UTC the day before, 13:00 = 06:00 UTC) over 4 days, with
    // the 13:00 slot of 19/10 missing: a gap in the chart. The last 01:00 slot is run_e2e_sched's.
    const slots: [string, string, number][] = [
      ['2026-10-17', '2026-10-17T18:00:00Z', 9],
      ['2026-10-18', '2026-10-18T06:00:00Z', 11],
      ['2026-10-18', '2026-10-18T18:00:00Z', 12],
      ['2026-10-19', '2026-10-19T18:00:00Z', 14],
      ['2026-10-20', '2026-10-20T06:00:00Z', 15],
      ['2026-10-20', '2026-10-20T18:00:00Z', 17],
    ];
    for (const [day, slot, n] of slots) {
      await q(`insert into keyword_days (keyword_id, crawl_day, slot, running_ads) values ($1, $2, $3, $4)`, [MUG.keywordId, day, slot, n]);
      await q(`insert into shop_days (landing_domain, crawl_day, slot, running_ads) values ($1, $2, $3, $4)`, [MUG.domain, day, slot, Math.round(n / 2)]);
    }
    await q(`insert into shops (landing_domain, page_ids, first_seen_date, last_seen_date, running_ads) values ($1, '{p_mug}', '2026-10-01', '2026-10-20', 8)`, [MUG.domain]);
    // An app store row as an older worker wrote it: in the nonShopDomains setting, so never listed as a shop.
    await q(`insert into shops (landing_domain, page_ids, first_seen_date, last_seen_date, running_ads) values ($1, '{p_app}', '2026-10-01', '2026-10-20', 40)`, [NON_SHOP_DOMAIN]);
    for (const [i, id] of MUG_ADS.entries()) {
      await q(
        `insert into ads (ad_archive_id, caption, page_name, landing_domain, media_type, start_date, end_date, seen_days, first_seen_date, last_seen_date, thumbnail_key, parsed)
         values ($1, $2, 'Dog Mom Shop', $3, 'image', $4, '2026-10-20', $5, '2026-10-01', '2026-10-20', $6, '{}'::jsonb)`,
        [id, `Best dog mom mug gift ${i + 1}`, MUG.domain, i < 2 ? '2026-10-19' : '2026-10-01', 3 + i, `${id}_image.jpg`],
      );
      await q(`insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day) values ($1, 'run_e2e_sched', $2, 'US', $3, '2026-10-20')`, [id, MUG.keywordId, i + 1]);
    }
    // Landing pages: e2e_mug_1 and _2 are one page (tracking parameters differ), _3 another; the rest have no link.
    await q(
      `update ads set link = case ad_archive_id
         when 'e2e_mug_1' then 'https://dogmom.example/products/mug?utm_source=fb&fbclid=abc'
         when 'e2e_mug_2' then 'https://dogmom.example/products/mug/?gclid=xyz'
         when 'e2e_mug_3' then 'https://dogmom.example/products/shirt' end
       where ad_archive_id in ('e2e_mug_1', 'e2e_mug_2', 'e2e_mug_3')`,
    );
    // A proven ad (7 variants): the market read and the "Đã chứng minh" chip.
    await q(`update ads set collation_count = 7 where ad_archive_id = 'e2e_mug_3'`);
    // An out-of-top ad: its pair was searched after it was last seen and stopped at the cap.
    await q(
      `insert into ads (ad_archive_id, caption, page_name, landing_domain, media_type, start_date, end_date, seen_days, first_seen_date, last_seen_date, parsed)
       values ('e2e_mug_old', 'Old dog mom mug', 'Dog Mom Shop', $1, 'image', '2026-09-01', '2026-10-10', 9, '2026-09-01', '2026-10-10', '{}'::jsonb)`,
      [MUG.domain],
    );
    await q(`insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day) values ('e2e_mug_old', 'run_e2e_sched', $1, 'GB', 40, '2026-10-10')`, [MUG.keywordId]);
    await q(`insert into crawl_searches (id, run_id, keyword_id, country, status, last_has_next) values ('cs_e2e_gb', 'run_e2e_sched', $1, 'GB', 'ok', true)`, [MUG.keywordId]);
    await q(`insert into keyword_days (keyword_id, crawl_day, slot, running_ads) values ('kw_e2e_1', '2026-10-20', '2026-10-20T18:00:00Z', 3)`);

    await seedIdeas(q);
    await seedBriefings(q);
    await seedThumbnails();
  } finally {
    await pool.end();
  }
}

type Query = (text: string, params?: unknown[]) => Promise<unknown>;

/** Ideas in store A (New, Picked, Done) and one in store B. */
async function seedIdeas(q: Query) {
  const idea = (id: string, store: string, status: string, title: string, hoursAgo: number) =>
    q(
      `insert into saved_ideas (id, store_id, source, source_ref, via, title, status, created_by, created_at, updated_at, snapshot)
       values ($1, $2, 'manual', $3, 'manual', $4, $5, $6, $7, $7, $8::jsonb)`,
      [id, store, `https://example.com/${id}`, title, status, USERS.admin.id, ago(hoursAgo), JSON.stringify({ keyword: MUG.keyword, link: `https://example.com/${id}` })],
    );
  await idea(IDEAS.fresh, STORES.a.id, 'new', 'Mug with paw print', 30);
  await idea(IDEAS.picked, STORES.a.id, 'picked', 'Dog mom tumbler', 20);
  await idea(IDEAS.done, STORES.a.id, 'done', 'Funny dog mom shirt', 10);
  await idea(IDEAS.b, STORES.b.id, 'new', 'Store B only idea', 5);
}

/**
 * Puts the ideas back to the seed. Earlier specs save and move ideas at the frozen clock, so those rows tie
 * on updated_at and their random ids decide the order: a screenshot of the ideas would change between runs.
 */
export async function resetIdeas(): Promise<void> {
  const pool = e2ePool();
  try {
    await pool.query(`delete from saved_ideas`);
    await seedIdeas((text, values) => pool.query(text, values));
  } finally {
    await pool.end();
  }
}

/** Sections in the stored shape of `packages/core/src/briefing/sections.ts`. */
function sections(ai: 'ok' | 'failed' | 'skipped') {
  const ad = (i: number) => ({
    adArchiveId: MUG_ADS[i]!,
    pageName: 'Dog Mom Shop',
    caption: `Best dog mom mug gift ${i + 1}`,
    landingDomain: MUG.domain,
    thumbnailKey: MUG_ADS[i] === 'e2e_mug_missing' ? null : `${MUG_ADS[i]}_image.jpg`,
    keyword: MUG.keyword,
    countries: ['CA', 'US'],
    daysActive: 3 + i,
    trendScore: 90 - i * 7,
  });
  const items = [
    { id: 'news_e2e_1', title: 'Holiday shoppers start early this year', link: 'https://example.com/news/holiday-shoppers', publishedAt: '2026-10-20', feed: 'Retail News' },
    { id: 'news_e2e_2', title: 'Personalized mugs top gift lists', link: 'https://example.com/news/mugs', publishedAt: '2026-10-19', feed: 'POD Weekly' },
  ];
  const holidays = [
    { date: '2026-10-31', name: 'Halloween', days: 10 },
    { date: '2026-11-26', name: 'Thanksgiving', days: 36 },
  ];
  const missing = ai === 'failed' ? { state: 'failed', reason: 'ai' } : { state: 'skipped', reason: 'cost_cap' };
  return {
    sourceRun: { id: 'run_e2e_sched', scheduledFor: '2026-10-20T18:00:00.000Z', runningAds: 4210, okSearches: 158, plannedSearches: 160 },
    kpi: { runningAds: 4210, delta: { change: 312, baselineDay: '2026-10-13', partial: false }, okRate: 158 / 160, nextHoliday: { date: '2026-10-31', name: 'Halloween', days: 10 } },
    topAds: [ad(0), ad(1), ad(2), ad(5)],
    risingAds: [{ ...ad(3), sightings: 4, bestPosition: 2 }, { ...ad(4), sightings: 2, bestPosition: 7 }],
    hotKeywords: [
      { key: MUG.keywordId, label: MUG.keyword, runningAds: 17, delta: { change: 8, baselineDay: '2026-10-17', partial: true } },
      { key: 'kw_e2e_1', label: 'teacher shirt', runningAds: 3, delta: null },
    ],
    risingShops: [{ key: MUG.domain, label: MUG.domain, runningAds: 9, delta: { change: 4, baselineDay: '2026-10-17', partial: true } }],
    news: ai === 'ok' ? { state: 'ok', summary: 'Người mua sắm dịp lễ bắt đầu sớm; cốc cá nhân hóa đang được ưa chuộng.', items, holidays } : { ...missing, items, holidays },
    suggestions: ai === 'ok' ? { state: 'ok', count: 2 } : missing,
  };
}

async function seedBriefings(q: Query) {
  const brief = (id: string, date: string, ai: 'ok' | 'failed' | 'skipped', readyAt: string, keywordId: string | null = null) =>
    q(
      `insert into briefings (id, date, scope, keyword_id, sections, llm_calls, ai_cost_usd, ready_at) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [id, date, keywordId ? 'keyword' : 'global', keywordId, JSON.stringify(sections(ai)), ai === 'skipped' ? 0 : ai === 'failed' ? 2 : 1, ai === 'ok' ? '0.0420' : '0', readyAt],
    );
  await brief(BRIEFINGS.today, '2026-10-21', 'ok', '2026-10-20T23:40:00Z');
  await brief(BRIEFINGS.failed, '2026-10-20', 'failed', '2026-10-19T23:45:00Z');
  await brief(BRIEFINGS.skipped, '2026-10-19', 'skipped', '2026-10-18T23:41:00Z');
  await brief(BRIEFINGS.keyword, '2026-10-21', 'ok', '2026-10-20T23:50:00Z', MUG.keywordId);
  const sug = (id: string, briefingId: string, kind: string, text: string, reason: string, evidence: object) =>
    q(`insert into suggestions (id, briefing_id, kind, text, reason, evidence) values ($1, $2, $3, $4, $5, $6::jsonb)`, [id, briefingId, kind, text, reason, JSON.stringify(evidence)]);
  await sug(SUGGESTIONS.idea, BRIEFINGS.today, 'idea', 'Cốc "Dog Mom" in tên thú cưng', 'Ba ads cốc dog mom đang lên trong 3 ngày.', { ads: ['e2e_mug_1', 'e2e_mug_4'], news: ['news_e2e_2'] });
  await sug(SUGGESTIONS.keyword, BRIEFINGS.today, 'keyword', 'halloween dog mom shirt', 'Halloween còn 10 ngày, dog mom đang nóng.', { ads: ['e2e_mug_2'], news: ['news_e2e_1'] });
  await sug(SUGGESTIONS.kwIdea, BRIEFINGS.keyword, 'idea', 'Bộ cốc đôi dog mom và dog dad', 'Keyword dog mom mug tăng 8 ads.', { ads: ['e2e_mug_1'], news: [] });
}

/** Thumbnails of MUG_ADS in the e2e bucket, as the worker stores them (`thumbs/<key>`), but not `missing`. */
async function seedThumbnails() {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: E2E_BUCKET }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: E2E_BUCKET }));
  }
  for (const [i, id] of MUG_ADS.entries()) {
    if (id === 'e2e_mug_missing') continue;
    // A 600 px JPEG in its own hue with a numbered shape, so each card looks different. sharp's `noise`
    // replaces `background`, which made every thumbnail the same gray.
    const hue = (i * 360) / MUG_ADS.length;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
      <rect width="600" height="600" fill="hsl(${hue} 65% 55%)"/>
      <circle cx="${150 + 60 * i}" cy="${200 + 30 * i}" r="140" fill="hsl(${(hue + 180) % 360} 70% 80%)"/>
      <text x="300" y="380" font-family="sans-serif" font-size="240" font-weight="700" text-anchor="middle" fill="#ffffff">${i + 1}</text>
    </svg>`;
    const body = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
    await client.send(new PutObjectCommand({ Bucket: E2E_BUCKET, Key: `thumbs/${id}_image.jpg`, Body: body, ContentType: 'image/jpeg' }));
  }
  client.destroy();
}

/** A direct database handle for tests that age a session or flip a flag. */
export function e2ePool(): pg.Pool {
  return new pg.Pool({ connectionString: e2eDatabaseUrl(), max: 2 });
}
