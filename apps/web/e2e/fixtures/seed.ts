// Fixed e2e seed data (plan Step 5 harness): one fixture per special state. The database is dropped and
// migrated again before every e2e run, so the tests start from exactly this data.
import { fileURLToPath } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { E2E_DB, E2E_FIXED_NOW, adminDatabaseUrl, e2eDatabaseUrl } from './env';

export const PASSWORD = 'e2e-password-123';
export const USERS = {
  admin: { id: 'user_e2e_admin', email: 'admin@e2e.test', name: 'Admin E2E', role: 'admin' },
  member: { id: 'user_e2e_member', email: 'member@e2e.test', name: 'Member E2E', role: 'member' },
  other: { id: 'user_e2e_other', email: 'other@e2e.test', name: 'Other E2E', role: 'member' },
} as const;
export const STORES = { a: { id: 'store_e2e_a', name: 'Store A' }, b: { id: 'store_e2e_b', name: 'Store B' } } as const;

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

    // Run log: a finished scheduled run and a manual one triggered by the admin.
    await q(
      `insert into crawl_runs (id, source, trigger, scheduled_for, status, planned_searches, ok_searches, running_ads, started_at, finished_at, deadline)
       values ('run_e2e_sched', 'fb_ad_library', 'schedule', $1, 'done', 160, 158, 4210, $1, $2, $3)`,
      [ago(7.5), ago(5), ago(3)],
    );
    await q(
      `insert into crawl_runs (id, source, trigger, triggered_by, status, planned_searches, ok_searches, running_ads, started_at, finished_at, deadline, requested_pairs)
       values ('run_e2e_manual', 'fb_ad_library', 'manual', $1, 'done', 2, 2, 120, $2, $3, $4, '[]'::jsonb)`,
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
  } finally {
    await pool.end();
  }
}

/** A direct database handle for tests that age a session or flip a flag. */
export function e2ePool(): pg.Pool {
  return new pg.Pool({ connectionString: e2eDatabaseUrl(), max: 2 });
}
