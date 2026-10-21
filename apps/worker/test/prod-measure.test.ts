// Phase 2 plan Step 7: the fixed SQL of scripts/sql/prod-measure on seeded data (run through roQuery as a role
// holding only PROD_MEASURE_GRANTS, as the forced-command key runs it), then scripts/windows/ops-report.ps1 in
// its fake-data mode on that output.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roQuery } from '../src/ops';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const sqlDir = join(repo, 'scripts/sql/prod-measure');
const runner = join(repo, 'scripts/windows/ops-report.ps1');
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const shellAvailable = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']).status === 0;

// What the prod-measure files read: Step 4.10 grants these to ideashub_ro next to RO_GRANTS (acceptance.test.ts).
// No ad, news, suggestion or Alert text is printed; alerts.detail is only compared.
const PROD_MEASURE_GRANTS: Record<string, string> = {
  crawl_runs:
    'id, trigger, scheduled_for, status, planned_searches, started_at, finished_at, deadline, running_ads, network_cooldowns, transient_retries, browser_restarts, two_page_stops_with_next, blocked_until, wait_limit_hits, close_reason',
  crawl_searches: 'run_id, status, ads_found, pages_read, stop_reason, started_at, finished_at',
  alerts: 'run_id, kind, detail, created_at, lark_message_id, lark_skipped_at, resolved_at',
  ads: 'first_seen_date',
  briefings: 'id, date, scope, sections, ready_at, llm_calls, ai_cost_usd',
  lark_messages: 'briefing_id, message_id',
};

const T_START = '2026-10-23T10:00:00Z';
const T_FIRST = '2026-10-23 18:00:00+00';
const H = 3_600_000;
const slot = (i: number) => new Date(Date.parse('2026-10-23T18:00:00Z') + i * 12 * H);

const fill = (sql: string, n: number) => sql.replaceAll('{{T_START}}', T_START).replaceAll('{{T_FIRST}}', T_FIRST).replaceAll('{{N}}', String(n));
const csvRows = (csv: string) => {
  const [head, ...rows] = csv.trim().split('\n');
  return rows.map((r) => Object.fromEntries(head!.split(',').map((k, i) => [k, r.split(',')[i] ?? ''])));
};

describe.skipIf(!testDatabaseAvailable())('scripts/sql/prod-measure', () => {
  let db: { url: string; drop: () => Promise<void> };
  let pool: pg.Pool;
  let roUrl: string;
  const role = `ih_pm_${randomBytes(4).toString('hex')}`;
  const tmp = mkdtempSync(join(tmpdir(), 'ih-prod-measure-'));
  const q = (name: string, n = 3) => roQuery(roUrl, fill(readFileSync(join(sqlDir, `${name}.sql`), 'utf8'), n));
  const run = async (id: string, at: Date, status: string, outcomes: string[], trigger = 'schedule') => {
    await pool.query(
      `insert into crawl_runs (id, source, trigger, scheduled_for, status, planned_searches, started_at, finished_at, deadline)
       values ($1, 'fb_ad_library', $2, $3, $4, 10, $5, $6, $7)`,
      [id, trigger, trigger === 'schedule' ? at : null, status, at, status === 'done' ? new Date(at.getTime() + 2 * H) : null, new Date(at.getTime() + 6 * H)],
    );
    for (const [i, s] of outcomes.entries()) {
      await pool.query(
        `insert into crawl_searches (id, run_id, keyword_id, country, status, ads_found, pages_read, stop_reason, started_at, finished_at)
         values ($1, $2, 'kw_0', $3, $4, $5, 3, $6, $7, $8)`,
        [`${id}_${i}`, id, `C${i}`, s, s === 'ok' ? 40 + i : 0, s === 'ok' ? 'cap' : null, at, s === 'skipped' ? null : new Date(at.getTime() + 30_000)],
      );
    }
  };
  const ok = (k: number, rest: string[] = []) => [...Array<string>(k).fill('ok'), ...rest];

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.url, max: 2 });
    await pool.query(`create role ${role} login password 'ro-test-only'`);
    for (const [table, cols] of Object.entries(PROD_MEASURE_GRANTS)) await pool.query(`grant select (${cols}) on ${table} to ${role}`);
    const u = new URL(db.url);
    u.username = role;
    u.password = 'ro-test-only';
    roUrl = u.toString();
    await pool.query(`insert into keywords (id, text, origin) values ('kw_0', 'k0', 'seed')`);
    // Backfilled by the host's first watchdog pass: missed, with the 'no row for this slot' Alert.
    for (const [i, at] of ['2026-10-22T06:00:00Z', '2026-10-22T18:00:00Z'].entries()) {
      await run(`bf_${i}`, new Date(at), 'missed', []);
      await pool.query(`insert into alerts (id, kind, run_id, detail, created_at) values ($1, 'missed_run', $2, 'no row for this slot', '2026-10-23T09:00:00Z')`, [`a_bf_${i}`, `bf_${i}`]);
    }
    // On the host before T_first: a real run, named but not counted.
    await run('pre', new Date('2026-10-23T06:00:00Z'), 'done', ok(10));
    // The 3-day window: 59 of 60 searches ok or no_results.
    for (let i = 0; i < 6; i++) await run(`w${i}`, slot(i), 'done', i === 2 ? ok(8, ['no_results', 'network_error']) : ok(10));
    // Days 4–5: a missed slot, a blocked slot whose other searches were skipped, and the last still running.
    await run('w6', slot(6), 'done', ok(10));
    await run('w7', slot(7), 'missed', []);
    await run('w8', slot(8), 'stopped', ['blocked', ...Array<string>(9).fill('skipped')]);
    await run('w9', slot(9), 'running', ok(3, ['running']));
    // Outside the measurement: a manual run inside the window and the slot after it.
    await run('manual', new Date(slot(1).getTime() + H), 'done', ok(10), 'manual');
    await run('after', slot(10), 'done', ok(10));
    await pool.query(`insert into alerts (id, kind, run_id, created_at, lark_message_id) values ('a_blk', 'blocked', 'w8', $1, 'om_1')`, [new Date(slot(8).getTime() + H)]);
    for (const [i, d] of ['2026-10-20', '2026-10-24', '2026-10-24', '2026-10-25'].entries()) {
      await pool.query(`insert into ads (ad_archive_id, first_seen_date, last_seen_date, parsed) values ($1, $2, $2, '{}')`, [`ad_${i}`, d]);
    }
    const sections = { sourceRun: { id: 'w0' }, kpi: {}, topAds: [{}, {}], risingAds: [{}], hotKeywords: [], risingShops: [{}], news: { state: 'ok', items: [{}] }, suggestions: { state: 'ok', count: 3 } };
    for (const d of ['2026-10-23', '2026-10-24', '2026-10-27']) {
      await pool.query(`insert into briefings (id, date, scope, sections, ready_at, llm_calls) values ($1, $2, 'global', $3, ($2::date + time '06:40') at time zone 'Asia/Ho_Chi_Minh', 2)`, [`brf_${d}`, d, sections]);
    }
  }, 60_000);
  afterAll(async () => {
    // The role outlives the test database otherwise.
    await pool?.query(`drop owned by ${role}`);
    await pool?.query(`drop role ${role}`);
    await pool?.end();
    await db?.drop();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('T_first is the first slot after T_start and not before 2026-10-23 06:00Z', async () => {
    expect(csvRows(await q('t-first'))).toEqual([{ t_first: T_FIRST }]);
  });

  it('counts only the finished scheduled runs of [T_first, T_first + N days)', async () => {
    expect(csvRows(await q('ratio', 3))).toEqual([
      { counted_runs: '6', unfinished_runs: '0', ok_searches: '59', planned_searches: '60', success_ratio: '0.9833', blocked_searches: '0', last_counted_deadline: '2026-10-26 12:00:00+00' },
    ]);
    // w9 still running is left out; w7 missed and w8's skipped searches count as failed.
    expect(csvRows(await q('ratio', 5))[0]).toMatchObject({ counted_runs: '9', unfinished_runs: '1', ok_searches: '69', planned_searches: '90', success_ratio: '0.7667', blocked_searches: '1' });
    expect(csvRows(await q('runs', 5)).map((r) => [r.id, r.counted, r.s_per_search])).toEqual([
      ['w0', 't', '720'], ['w1', 't', '720'], ['w2', 't', '720'], ['w3', 't', '720'], ['w4', 't', '720'], ['w5', 't', '720'], ['w6', 't', '720'], ['w7', 't', ''], ['w8', 't', ''], ['w9', 'f', ''],
    ]);
    expect(csvRows(await q('searches', 5))[0]).toMatchObject({ searches: '80', ok: '68', no_results: '1', blocked: '1', network_error: '1', skipped: '9', ads_per_ok_search: '44.4', stop_cap: '68', search_s_median: '30' });
  });

  it('names the backfilled slots and the runs before the measurement', async () => {
    expect(csvRows(await q('excluded')).map((r) => [r.id, r.status, r.missed_run_alert, r.backfilled])).toEqual([
      ['bf_0', 'missed', 't', 't'], ['bf_1', 'missed', 't', 't'], ['pre', 'done', 'f', 'f'],
    ]);
  });

  it('runs only on the granted columns', async () => {
    await expect(roQuery(roUrl, 'select caption from ads')).rejects.toThrow('permission denied');
    await expect(roQuery(roUrl, 'select reason from crawl_searches')).rejects.toThrow('permission denied');
  });

  it('reads Alerts, new ads and briefings of the window as counts', async () => {
    expect(csvRows(await q('alerts', 5))).toEqual([{ kind: 'blocked', alerts: '1', sent: '1', lark_skipped: '0', resolved: '0' }]);
    expect(await q('alerts', 3)).toBe('kind,alerts,sent,lark_skipped,resolved\n');
    expect(csvRows(await q('new-ads', 3))).toEqual([{ first_seen_date: '2026-10-24', new_ads: '2' }, { first_seen_date: '2026-10-25', new_ads: '1' }]);
    expect(csvRows(await q('briefings', 3))).toEqual([
      { date: '2026-10-24', ready_at: '2026-10-23 23:40:00+00', ready_before_0700: 't', sections: '8', source_run: 'w0', top_ads: '2', rising_ads: '1', hot_keywords: '0', rising_shops: '1', news_state: 'ok', news_items: '1', suggestions_state: 'ok', suggestions: '3', llm_calls: '2', ai_cost_usd: '0.0000', lark_sent: 'f' },
    ]);
  });

  describe.skipIf(!shellAvailable)('scripts/windows/ops-report.ps1 on fake data', () => {
    // The host's answers as the forced-command key would print them, for N = 3 or 5.
    const fakeHost = async (n: number, edit?: (name: string, csv: string) => string) => {
      const dir = mkdtempSync(join(tmp, `host${n}-`));
      for (const f of readdirSync(sqlDir).filter((f) => f.endsWith('.sql'))) {
        const name = f.slice(0, -4);
        const csv = await q(name, n);
        writeFileSync(join(dir, `${name}.csv`), edit ? edit(name, csv) : csv);
      }
      writeFileSync(join(dir, 'stats.txt'), 'time,unit,memory_peak_bytes,cpu_usage_nsec\n');
      return dir;
    };
    const opsDir = () => {
      const dir = mkdtempSync(join(tmp, 'ops-'));
      mkdirSync(join(dir, 'prod-measure'));
      writeFileSync(join(dir, 'prod-measure', 't-start.txt'), `${T_START}\n`);
      return dir;
    };
    const runReport = (ops: string, host: string, now: string, worktree?: string) => {
      const r = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner, '-Report', 'prod-measure', '-FakeData', host, '-OpsDir', ops, '-Now', now, ...(worktree ? ['-Worktree', worktree] : [])], { encoding: 'utf8' });
      const data = join(ops, 'prod-measure', 'data');
      return {
        status: r.status,
        out: r.stdout + r.stderr,
        verdict: existsSync(join(data, 'verdict.txt')) ? readFileSync(join(data, 'verdict.txt'), 'utf8').split('\n')[0] : '',
        summary: () => readFileSync(join(ops, 'prod-measure', readdirSync(join(ops, 'prod-measure')).find((f) => f.startsWith('lark-summary-'))!), 'utf8'),
      };
    };
    const day3 = '2026-10-26T23:00:00Z'; // T_first + 3 days + 5 hours
    const day5 = '2026-10-28T23:00:00Z'; // T_first + 5 days + 5 hours

    it('passes at N = 3, writes the summary from the figures and .done, and a second run stops at once', async () => {
      const ops = opsDir();
      const r = runReport(ops, await fakeHost(3), day3);
      expect(r.status, r.out).toBe(0);
      expect(r.verdict).toBe('pass');
      expect(r.summary()).toContain('PASS');
      expect(r.summary()).toContain('Success ratio 0.9833 (59 of 60 searches), blocked searches 0');
      expect(readFileSync(join(ops, 'prod-measure', 'data', 'window.txt'), 'utf8')).toContain(`T_first ${T_FIRST}\nN 3\n`);
      expect(existsSync(join(ops, 'prod-measure.done'))).toBe(true);
      const again = runReport(ops, await fakeHost(3), day3);
      expect(again.status).toBe(0);
      expect(again.out).toContain('prod-measure.done exists');
    }, 60_000);

    it('extends at N = 3 on a blocked search and stops before the worktree, without .done', async () => {
      const ops = opsDir();
      const blocked = (name: string, csv: string) => (name === 'ratio' ? csv.replace(/,0,2026-10-26/, ',1,2026-10-26') : csv);
      const r = runReport(ops, await fakeHost(3, blocked), day3);
      expect(r.status, r.out).toBe(0);
      expect(r.verdict).toBe('extend');
      expect(r.out).toContain('1 blocked searches');
      expect(r.out).not.toContain('would: git worktree add');
      expect(existsSync(join(ops, 'prod-measure.done'))).toBe(false);
    }, 60_000);

    it('fails at N = 5 under 0.90 and keeps the freeze', async () => {
      const ops = opsDir();
      const r = runReport(ops, await fakeHost(5), day5);
      expect(r.status, r.out).toBe(0);
      expect(r.verdict).toBe('fail');
      expect(r.out).toContain('9 of 10 runs counted; success ratio 0.7667 below 0.90');
      expect(r.summary()).toContain('Code freeze: stays');
      expect(existsSync(join(ops, 'prod-measure.done'))).toBe(false);
    }, 60_000);

    it('refuses to commit changes outside docs/ or a secret pattern, and accepts a docs/ change', async () => {
      const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
      const tree = (files: Record<string, string>) => {
        const wt = mkdtempSync(join(tmp, 'wt-'));
        git(wt, 'init', '-q');
        mkdirSync(join(wt, 'docs'));
        writeFileSync(join(wt, 'docs', 'a.md'), 'old\n');
        git(wt, 'add', '-A');
        git(wt, 'commit', '-qm', 'base');
        for (const [f, body] of Object.entries(files)) writeFileSync(join(wt, f), body);
        return wt;
      };
      const host = await fakeHost(3);
      expect(runReport(opsDir(), host, day3, tree({ 'docs/a.md': 'new\n', 'x.ts': '1\n' })).out).toContain('no PR: changes outside docs/: x.ts');
      expect(runReport(opsDir(), host, day3, tree({ 'docs/a.md': 'RO_DATABASE_URL=postgres://u:p@h/db\n' })).out).toContain('no PR: the diff matches a secret pattern');
      const clean = runReport(opsDir(), host, day3, tree({}));
      expect(clean.out).toContain('no PR: the model left no change');
      expect(clean.summary()).toContain('Report PR: none (the model left no change)');
      expect(runReport(opsDir(), host, day3, tree({ 'docs/b.md': 'figures\n' })).out).toContain('would: commit, push');
    }, 120_000);
  });
});
