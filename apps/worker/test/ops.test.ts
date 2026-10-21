import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { vietnamInstant } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { larkPost, opsAlert, quietReasons, roQuery, toCsv } from '../src/ops';
import { CRAWL } from '../src/queues';
import { type AlertRow, watchdogPass } from '../src/watchdog-pass';
import { fakeLark } from './fakes';
import { type Harness, all, harness, insertRun, setSettings } from './helpers';

const MIN = 60_000;
const cli = fileURLToPath(new URL('../src/ops-cli.ts', import.meta.url));
/** Runs ops-cli.ts as the pnpm scripts do; asynchronous, so the in-process fake Lark server can answer. */
function runCli(args: string[], input: string, env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--import', 'tsx', cli, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (status) => resolve({ status, stdout, stderr }));
    p.stdin.end(input);
  });
}

it('writes RFC 4180 CSV', () => {
  expect(toCsv(['a', 'b'], [['x,y', null], ['say "hi"', 'line\nbreak']])).toBe('a,b\n"x,y",\n"say ""hi""","line\nbreak"\n');
});

describe.skipIf(!testDatabaseAvailable())('ops CLIs', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness('2026-10-21T03:00:00Z'); // 10:00 Asia/Ho_Chi_Minh
  }, 60_000);
  afterAll(() => h?.close());
  beforeEach(async () => {
    await h.db.execute(sql`truncate crawl_runs, alerts cascade`);
    await h.db.execute(sql`delete from pgboss.job`);
  });

  describe('ops:alert', () => {
    it('inserts once per kind and key, a warning and a critical of the same day are both sent, and tests keep their own keys', async () => {
      const at = h.clock.now();
      expect(await opsAlert(h.db, 'deploy_failed', 'abc123:build', 'build failed', at)).toBe(true);
      expect(await opsAlert(h.db, 'deploy_failed', 'abc123:build', 'build failed again', at)).toBe(false);
      expect(await opsAlert(h.db, 'deploy_failed', 'abc123:health', 'health failed', at)).toBe(true);
      expect(await opsAlert(h.db, 'disk_space', '2026-10-21:/home:warn', '81%', at)).toBe(true);
      expect(await opsAlert(h.db, 'disk_space', '2026-10-21:/home:critical', '91%', at)).toBe(true);
      expect(await opsAlert(h.db, 'disk_space', 'test:1792540000', 'drill', at)).toBe(true);
      // The same key under another kind is another Alert.
      expect(await opsAlert(h.db, 'backup_failed', 'abc123:build', 'x', at)).toBe(true);

      const sent: AlertRow[] = [];
      await watchdogPass(h, { restartWorker: async () => {}, sendAlert: async (a) => (sent.push(a), `om_${a.id}`) });
      expect(sent.filter((a) => a.kind === 'disk_space').map((a) => a.detail)).toEqual(['81%', '91%', 'drill']);
      expect(sent).toHaveLength(6);
    });

    it('refuses an unknown kind, a non-ops kind and an empty key', async () => {
      await expect(opsAlert(h.db, 'disk_full', 'k', 'x', h.clock.now())).rejects.toThrow('unknown ops Alert kind');
      await expect(opsAlert(h.db, 'blocked', 'k', 'x', h.clock.now())).rejects.toThrow('unknown ops Alert kind');
      await expect(opsAlert(h.db, 'disk_space', '', 'x', h.clock.now())).rejects.toThrow('dedupe key');
      expect(await all(h, sql`select 1 from alerts`)).toEqual([]);
    });

    it('works from the command line', async () => {
      const env = { DATABASE_URL: h.url };
      const first = await runCli(['alert', 'retention_failed', '2026-10-21', 'boom'], '', env);
      expect([first.status, first.stdout.trim()]).toEqual([0, 'alert retention_failed 2026-10-21 inserted']);
      expect((await runCli(['alert', 'retention_failed', '2026-10-21', 'boom'], '', env)).stdout.trim()).toBe('alert retention_failed 2026-10-21 already there');
      expect((await runCli(['alert', 'nope', 'k', 'x'], '', env)).status).toBe(2);
      expect((await runCli(['alert', 'retention_failed', 'k'], '', env)).status).toBe(2);
    });
  });

  describe('retention', () => {
    it('prints the counts, and on an error exits 1 with a retention_failed Alert keyed by the UTC date', async () => {
      // Nothing past retention: the object store is never called, so an unreachable one does not matter.
      const env = { DATABASE_URL: h.url, S3_ENDPOINT: 'http://127.0.0.1:1', S3_ACCESS_KEY: 'x', S3_SECRET_KEY: 'x' };
      const ok = await runCli(['retention'], '', env);
      expect(ok.status, ok.stderr).toBe(0);
      expect(JSON.parse(ok.stdout)).toMatchObject({ msg: 'retention', sightings: 0, thumbnails: 0 });

      await h.db.execute(sql`insert into ads (ad_archive_id, first_seen_date, last_seen_date, thumbnail_key, parsed)
        values ('ad_cli', '2000-01-01', '2000-01-01', 'ad_cli_image.jpg', '{}'::jsonb)`);
      try {
        const failed = await runCli(['retention'], '', env);
        expect(failed.status).toBe(1);
        const rows = await all<{ dedupe_key: string; detail: string }>(h, sql`select dedupe_key, detail from alerts where kind = 'retention_failed'`);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.dedupe_key).toBe(new Date().toISOString().slice(0, 10));
        expect(rows[0]!.detail).toMatch(/^retention failed: /);
        expect(await all(h, sql`select thumbnail_key from ads`)).toEqual([{ thumbnail_key: 'ad_cli_image.jpg' }]);
      } finally {
        await h.db.execute(sql`truncate ads cascade`);
      }
    }, 60_000);
  });

  describe('ops:quiet', () => {
    const at = new Date('2026-10-21T03:00:00Z'); // 10:00, far from the 06:30 build
    const deadline = new Date(at.getTime() + 5 * 3_600_000);

    it('is quiet with nothing near', async () => {
      await insertRun(h, { scheduledFor: new Date(at.getTime() + 46 * MIN), deadline });
      await insertRun(h, { scheduledFor: new Date(at.getTime() - 11 * MIN), deadline, status: 'missed' });
      await insertRun(h, { scheduledFor: new Date(at.getTime() - 12 * MIN), deadline: at, id: 'run_old' });
      await insertRun(h, { trigger: 'cli', deadline, status: 'done' });
      expect(await quietReasons(h.db, at)).toEqual([]);
    });

    it('is closed by a running run, a run due within 45 minutes or in the last 10, a manual run waiting, and an active job', async () => {
      await insertRun(h, { id: 'run_a', trigger: 'cli', deadline, status: 'running' });
      expect(await quietReasons(h.db, at)).toEqual(['crawl run run_a is running']);
      await h.db.execute(sql`truncate crawl_runs cascade`);
      await insertRun(h, { id: 'run_b', scheduledFor: new Date(at.getTime() + 45 * MIN), deadline });
      await insertRun(h, { id: 'run_c', scheduledFor: new Date(at.getTime() - 10 * MIN), deadline });
      expect((await quietReasons(h.db, at)).sort()).toEqual(['crawl run run_b is due 2026-10-21T03:45Z', 'crawl run run_c is due 2026-10-21T02:50Z']);
      await h.db.execute(sql`truncate crawl_runs cascade`);
      await insertRun(h, { id: 'run_d', trigger: 'manual', deadline });
      expect(await quietReasons(h.db, at)).toEqual(['crawl run run_d is due now (manual)']);
      await h.db.execute(sql`truncate crawl_runs cascade`);
      const job = await h.boss.send(CRAWL, { runId: 'run_x' });
      await h.pool.query(`update pgboss.job set state = 'active' where id = $1`, [job]);
      expect(await quietReasons(h.db, at)).toEqual([`crawl.run job ${job} is active`]);
    });

    it('is closed from 10 minutes before to 40 after the briefing build time in settings', async () => {
      await setSettings(h, { briefingBuildTime: '00:05' });
      const build = vietnamInstant('2026-10-21', '00:05').getTime();
      const closed = (ms: number) => quietReasons(h.db, new Date(build + ms)).then((r) => r.length > 0);
      expect([await closed(-11 * MIN), await closed(-10 * MIN), await closed(40 * MIN), await closed(41 * MIN)]).toEqual([false, true, true, false]);
      // 23:58 the evening before is 7 minutes before the next day's build.
      expect(await closed(-7 * MIN)).toBe(true);
      await setSettings(h, { briefingBuildTime: '06:30' });
    });

    it('exits 10 with the reasons from the command line, 0 when quiet, and 1 without a database', async () => {
      // The CLI uses the real clock; a build time 12 hours away keeps the briefing window out of it.
      const away = new Date(Date.now() + 7 * 3_600_000 + 12 * 3_600_000);
      await setSettings(h, { briefingBuildTime: `${String(away.getUTCHours()).padStart(2, '0')}:00` });
      expect((await runCli(['quiet'], '', { DATABASE_URL: h.url })).status).toBe(0);
      await insertRun(h, { id: 'run_e', trigger: 'cli', deadline: new Date(Date.now() + 3_600_000), status: 'running' });
      const busy = await runCli(['quiet'], '', { DATABASE_URL: h.url });
      expect([busy.status, busy.stdout.trim()]).toEqual([10, 'crawl run run_e is running']);
      expect((await runCli(['quiet'], '', { DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none' })).status).toBe(1);
      await setSettings(h, { briefingBuildTime: '06:30' });
    });
  });

  describe('ro-query', () => {
    const role = `ih_ro_${randomBytes(4).toString('hex')}`;
    let roUrl: string;
    beforeAll(async () => {
      await h.db.execute(sql.raw(`create role ${role} login password 'ro-test-only'; grant select on settings to ${role}`));
      const u = new URL(h.url);
      u.username = role;
      u.password = 'ro-test-only';
      roUrl = u.toString();
    });
    afterAll(async () => {
      await h.db.execute(sql.raw(`revoke all on settings from ${role}`));
      // The role outlives the test database otherwise; it owns nothing.
      await h.db.execute(sql.raw(`drop role ${role}`));
    });

    it('prints the rows as CSV, every result of a multi-statement text, and refuses a write', async () => {
      expect(await roQuery(roUrl, `select key, value from settings where key in ('runTimes', 'searchBudget') order by key`)).toBe('key,value\nrunTimes,"[""01:00"", ""13:00""]"\nsearchBudget,160\n');
      expect(await roQuery(roUrl, `set statement_timeout = 0; select 1 as a; select 'x' as b`)).toBe('a\n1\n\nb\nx\n');
      await expect(roQuery(roUrl, `update settings set value = '1' where key = 'searchBudget'`)).rejects.toThrow('permission denied');
      await expect(roQuery(roUrl, `select * from alerts`)).rejects.toThrow('permission denied');
    });

    it('cancels a query after the limit even when the text lifts statement_timeout', async () => {
      await expect(roQuery(roUrl, `set statement_timeout = 0; select pg_sleep(30)`, 500)).rejects.toThrow('query cancelled after 0.5 s');
      expect(await all(h, sql`select 1 from pg_stat_activity where usename = ${role} and state = 'active' and query like '%pg_sleep%'`)).toEqual([]);
    });

    it('reads stdin and prints CSV from the command line', async () => {
      const r = await runCli(['ro-query'], `select key from settings where key = 'searchBudget'`, { RO_DATABASE_URL: roUrl });
      expect([r.status, r.stdout]).toEqual([0, 'key\nsearchBudget\n']);
      const w = await runCli(['ro-query'], `delete from settings`, { RO_DATABASE_URL: roUrl });
      expect(w.status).toBe(1);
      expect(w.stderr).toContain('permission denied');
      expect(w.stderr).not.toContain('ro-test-only');
    });
  });

  describe('lark:post', () => {
    let lark: Awaited<ReturnType<typeof fakeLark>>;
    beforeAll(async () => {
      lark = await fakeLark();
    });
    afterAll(() => lark?.close());

    it('posts stdin to the admin chat through the bot app, and fails when Lark is not configured', async () => {
      const env = { LARK_APP_ID: 'cli_test', LARK_APP_SECRET: 'test-secret', LARK_BASE_URL: lark.url, LARK_ADMIN_CHAT_ID: 'oc_admin', LARK_SHARED_CHAT_ID: '' };
      const r = await runCli(['lark-post'], 'restore failed on the host', env);
      expect(r.status, r.stderr).toBe(0);
      expect(lark.messages.map((m) => [m.chat, m.text])).toEqual([['oc_admin', 'restore failed on the host']]);
      await expect(larkPost('x', {})).rejects.toThrow('Lark is not configured');
      await expect(larkPost('  ', env)).rejects.toThrow('stdin is empty');
    });
  });
});
