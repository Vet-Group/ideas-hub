// Phase 2 plan Step 8, day 14: scripts/windows/ops-report.ps1 -Report pilot-verdict in its fake-data mode. The
// verdict SQL itself is tested in acceptance.test.ts; here the CSVs stand in for its output.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const runner = join(repo, 'scripts/windows/ops-report.ps1');
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const shellAvailable = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'ih-pilot-verdict-'));
const SHA = 'a'.repeat(40);

const PASSING: Record<string, string> = {
  ac1_success_ratio: 'ok_searches,planned_searches,success_ratio\n10500,11200,0.9375',
  ac1_alerts: 'blocked_unsent,parse_error_unsent,network_mismatch\n0,0,0',
  ac2_violations: 'ok_without_embedded,has_next_without_page,silent_stops\n0,0,0',
  ac3_briefings: 'days,days_ok,late_days,unresolved_refs,days_over_cap\n14,13,2026-10-27,0,0',
  ac6_ideas: 'ideas,stores_with_10,per_store\n0,0,{}',
};

const host = (edit: Record<string, string> = {}, tests = 'install 0\ntest 0\ne2e 0\n') => {
  const dir = mkdtempSync(join(tmp, 'host-'));
  for (const [name, csv] of Object.entries({ ...PASSING, ...edit })) writeFileSync(join(dir, `${name}.csv`), `${csv}\n`);
  writeFileSync(join(dir, 'stats.txt'), `time,unit,memory_peak_bytes\n${SHA}\n`);
  writeFileSync(join(dir, 'tests.txt'), tests);
  return dir;
};

// A git tree holding the plan heading the runner adds its verdict line under.
const tree = () => {
  const wt = mkdtempSync(join(tmp, 'wt-'));
  const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: wt });
  git('init', '-q');
  mkdirSync(join(wt, 'docs', 'plans'), { recursive: true });
  mkdirSync(join(wt, 'docs', 'ops'));
  writeFileSync(join(wt, 'docs', 'plans', 'ideas-hub-phase-2.md'), '# Plan\n\n### Step 8. 14-day pilot\n\n- Before day 1: ...\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return wt;
};

const run = (hostDir: string, worktree?: string) => {
  const ops = mkdtempSync(join(tmp, 'ops-'));
  mkdirSync(join(ops, 'pilot-verdict'));
  writeFileSync(join(ops, 'pilot-verdict', 'run-start.txt'), '2026-10-22T17:00:00Z\n');
  const r = spawnSync(
    shell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner, '-Report', 'pilot-verdict', '-FakeData', hostDir, '-OpsDir', ops, '-Now', '2026-11-05T19:00:00Z', ...(worktree ? ['-Worktree', worktree] : [])],
    { encoding: 'utf8' },
  );
  const dir = join(ops, 'pilot-verdict');
  const read = (f: string) => readFileSync(join(dir, 'data', f), 'utf8');
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    verdict: () => read('verdict.txt').split('\n')[0],
    report: () => read('report.md'),
    lark: () => readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith('lark-summary-'))!), 'utf8'),
  };
};

describe.skipIf(!shellAvailable)('ops-report.ps1 -Report pilot-verdict on fake data', () => {
  it('passes when every graded AC passes, leaves AC 6 not measured, and writes the report and the plan line', () => {
    const wt = tree();
    const r = run(host(), wt);
    expect(r.status, r.out).toBe(0);
    expect(r.verdict()).toBe('PASS');
    expect(r.report()).toContain('| AC 1 | success_ratio 0.9375 (10500/11200); blocked_unsent 0, parse_error_unsent 0, network_mismatch 0 |');
    expect(r.report()).toContain('days_ok 13/14 (not on time: 2026-10-27)');
    expect(r.report()).toMatch(/\| AC 6 \|.*\| not measured \|/);
    expect(r.report()).toContain(`Commit under test: \`${SHA}\``);
    expect(r.report()).not.toContain('Fix options');
    expect(readFileSync(join(wt, 'docs', 'ops', 'pilot-verdict.md'), 'utf8')).toBe(r.report());
    expect(readFileSync(join(wt, 'docs', 'plans', 'ideas-hub-phase-2.md'), 'utf8')).toContain(
      '### Step 8. 14-day pilot\n\n**Verdict 2026-11-05: PASS** ([docs/ops/pilot-verdict.md](../ops/pilot-verdict.md)).\n',
    );
    expect(r.out).toContain('would: commit, push');
    expect(r.out).toContain('would: comment on #55 and close it');
    expect(r.lark()).toContain('Ideas Hub 14-day pilot: PASS');
  }, 60_000);

  it('fails on a low success ratio and a failed e2e run, lists fix options, and keeps #55 open', () => {
    const r = run(host({ ac1_success_ratio: 'ok_searches,planned_searches,success_ratio\n9520,11200,0.8500' }, 'install 0\ntest 0\ne2e 1\n'));
    expect(r.status, r.out).toBe(0);
    expect(r.verdict()).toBe('FAIL');
    expect(r.report()).toContain('Verdict: **FAIL** (AC 1, AC 5, AC 7 failed)');
    expect(r.report()).toContain('## Fix options for the owner');
    expect(r.report()).toContain('- AC 5: fix the failing e2e cases');
    expect(r.out).toContain('would: comment on #55');
    expect(r.out).not.toContain('and close it');
    expect(r.lark()).toContain('issue #55 stays open');
  }, 60_000);

  it('fails AC 3 at 12 on-time days', () => {
    const r = run(host({ ac3_briefings: 'days,days_ok,late_days,unresolved_refs,days_over_cap\n14,12,2026-10-27 2026-10-30,0,0' }));
    expect(r.verdict()).toBe('FAIL');
    expect(r.report()).toMatch(/\| AC 3 \|.*\| \*\*fail\*\* \|/);
  }, 60_000);
});
