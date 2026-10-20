import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, createDb, createPool } from '../client';
import { createTestDatabase, testDatabaseAvailable } from '../testing';
import { escapeLike, globalSearch } from './search';

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
});

describe.skipIf(!testDatabaseAvailable())('globalSearch', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 2);
    db = createDb(pool);
    const ad = (id: string, caption: string, page: string, domain: string, lastSeen: string) =>
      sql`(${id}, ${caption}, ${page}, ${domain}, '2026-10-01', ${lastSeen}, '{}'::jsonb)`;
    await db.execute(sql`insert into ads (ad_archive_id, caption, page_name, landing_domain, first_seen_date, last_seen_date, parsed) values
      ${sql.join(
        [
          ad('a1', '50% off teacher shirt', 'Shop One', 'one.com', '2026-10-10'),
          ad('a2', '50 off teacher shirt', 'Shop Two', 'two.com', '2026-10-12'),
          ad('a3', 'teacher_shirt bundle', 'Shop Three', 'three.com', '2026-10-11'),
          ad('a4', 'teacher shirt', 'Teacher Shirt Co', 'teachershirt.com', '2026-10-09'),
          ...Array.from({ length: 6 }, (_, i) => ad(`b${i}`, `mug number ${i}`, 'Mugs', `mug${i}.com`, `2026-10-0${i + 1}`)),
        ],
        sql`, `,
      )}`);
    await db.execute(sql`insert into keywords (id, text, origin) values ('kw_1', 'teacher shirt', 'seed'), ('kw_2', 'nurse shirt', 'seed')`);
    await db.execute(sql`insert into shops (landing_domain, first_seen_date, last_seen_date, running_ads) values ('teachershirt.com', '2026-10-01', '2026-10-09', 4)`);
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('starts at 3 characters', async () => {
    expect(await globalSearch(db, 'te')).toEqual({ ads: [], shops: [], keywords: [] });
  });

  it('treats % and _ as plain characters', async () => {
    expect((await globalSearch(db, '50%')).ads.map((a) => a.adArchiveId)).toEqual(['a1']);
    expect((await globalSearch(db, 'r_s')).ads.map((a) => a.adArchiveId)).toEqual(['a3']);
  });

  it('ranks the closer match first, then by last seen, and keeps 5 per group', async () => {
    const r = await globalSearch(db, 'teacher shirt');
    expect(r.ads[0]?.adArchiveId).toBe('a4');
    expect(r.keywords.map((k) => k.text)).toEqual(['teacher shirt']);
    expect((await globalSearch(db, 'teachershirt')).shops.map((s) => s.landingDomain)).toEqual(['teachershirt.com']);
    const mugs = await globalSearch(db, 'mug number');
    expect(mugs.ads.map((a) => a.adArchiveId)).toEqual(['b5', 'b4', 'b3', 'b2', 'b1']);
  });
});
