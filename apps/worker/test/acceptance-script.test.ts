// scripts/linux/ideashub-acceptance on the fake host of ops-host.ts (phase 2 plan Step 8): the fake
// `pnpm --silent ro-query` answers with $FAKE/ro.csv (acceptance.test.ts gives it real query output).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { Host, bash, scriptPath } from './ops-host';

const acceptanceScript = scriptPath('ideashub-acceptance');
const acceptanceSql = readFileSync(new URL('../../../scripts/acceptance.sql', import.meta.url), 'utf8');
/** Today in Asia/Ho_Chi_Minh, the Alert key. */
const vnToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

/** ro-query's output for scripts/acceptance.sql with every threshold met, values overridable by column. */
function roOutput(v: Record<string, string> = {}) {
  const block = (cols: Record<string, string>) => {
    const c = { ...cols, ...Object.fromEntries(Object.entries(v).filter(([k]) => k in cols)) };
    return `${Object.keys(c).join(',')}\n${Object.values(c).join(',')}\n`;
  };
  return [
    block({ ok_searches: '980', planned_searches: '1000', success_ratio: '0.9800' }),
    block({ ok_without_embedded: '0', has_next_without_page: '0', silent_stops: '0' }),
    block({ blocked_unsent: '0', parse_error_unsent: '0', network_mismatch: '0' }),
    block({ days: '14', days_ok: '14', unresolved_refs: '0', days_over_cap: '0' }),
    block({ date: '2026-10-21', ready_at: '06:41', on_time: 't', sections_ok: 't' }),
    // A quoted value with commas, as ro-query prints jsonb.
    block({ ideas: '31', stores_with_10: '2', per_store: '"{""S1"": 20, ""S2"": 11}"' }),
  ].join('\n');
}

/** A host whose HOME holds ~/.config/ideas-hub/ro.env, as on vet-linux; the unit loads no environment. */
function acceptanceHost(csv?: string, roEnv = true) {
  const h = new Host({ 'scripts/acceptance.sql': acceptanceSql }, acceptanceScript);
  if (csv !== undefined) writeFileSync(`${h.fake}/ro.csv`, csv);
  if (roEnv) {
    mkdirSync(`${h.home}/.config/ideas-hub`, { recursive: true });
    writeFileSync(`${h.home}/.config/ideas-hub/ro.env`, 'RO_DATABASE_URL=postgres://ideashub_ro@localhost:5433/ideas_hub\n');
  }
  return h;
}

describe('ideashub-acceptance', () => {
  const hosts: Host[] = [];
  const host = (csv?: string, roEnv = true) => {
    const h = acceptanceHost(csv, roEnv);
    hosts.push(h);
    return h;
  };
  afterEach(() => hosts.splice(0).forEach((h) => h.close()));

  it('passes bash -n', () => {
    expect(spawnSync(bash, ['-n', acceptanceScript]).status).toBe(0);
  });

  it('runs acceptance.sql through ro-query, logs the output and writes no Alert when every threshold holds', () => {
    const h = host(roOutput());
    const r = h.run();
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(`${h.fake}/ro.sql`, 'utf8')).toBe(acceptanceSql);
    expect(h.callsOf('pnpm')).toEqual(['--silent ro-query']);
    const log = h.file('acceptance.log')!;
    expect(log).toContain(`check for ${vnToday()}`);
    expect(log).toContain('ok_searches,planned_searches,success_ratio\n980,1000,0.9800');
    expect(log).toMatch(/passed$/);
  });

  it('takes 0.9000 as a pass and 0.8999 as a failure', () => {
    expect(host(roOutput({ success_ratio: '0.9000' })).run().out).toContain('passed');
    const h = host(roOutput({ ok_searches: '899', success_ratio: '0.8990' }));
    expect(h.run().status).toBe(0);
    expect(h.alerts('acceptance_failed')).toEqual([`${vnToday()} AC 1: success_ratio 0.8990 (899/1000) < 0.90`]);
  });

  it('fails AC 1 when nothing was planned', () => {
    const h = host(roOutput({ ok_searches: '0', planned_searches: '0', success_ratio: '' }));
    h.run();
    expect(h.alerts('acceptance_failed')).toEqual([`${vnToday()} AC 1: no planned searches in 14 days`]);
  });

  it('lists every AC 1 and AC 2 violation and both of today\'s briefing faults in one Alert', () => {
    const h = host(roOutput({ network_mismatch: '2', parse_error_unsent: '1', silent_stops: '3', ready_at: '07:12', on_time: 'f', sections_ok: 'f' }));
    const r = h.run();
    expect(r.status, r.out).toBe(0);
    expect(h.alerts('acceptance_failed')).toEqual([
      `${vnToday()} AC 1: parse_error_unsent 1; AC 1: network_mismatch 2; AC 2: silent_stops 3; AC 3: today's briefing ready at 07:12, not before 07:00; AC 3: today's briefing lacks its 6 generated sections`,
    ]);
    expect(h.file('acceptance.log')).toContain('  failed: AC 2: silent_stops 3');
  });

  it('fails AC 3 when today has no briefing', () => {
    const h = host(roOutput({ ready_at: '', on_time: 'f', sections_ok: 'f' }));
    h.run();
    expect(h.alerts('acceptance_failed')).toEqual([`${vnToday()} AC 3: today's briefing not ready, not before 07:00; AC 3: today's briefing lacks its 6 generated sections`]);
  });

  it('Alerts when the queries fail or a checked column is missing; exit 1 only when the queries failed', () => {
    const failed = host('');
    const r = failed.run([], { FAKE_RO_ERR: 'permission denied for table briefings' });
    expect(r.status).toBe(1);
    expect(failed.alerts('acceptance_failed')).toEqual([`${vnToday()} acceptance queries failed: permission denied for table briefings`]);

    const missing = host(roOutput().replace('on_time,', 'on_time_x,'));
    expect(missing.run().status).toBe(0);
    expect(missing.alerts('acceptance_failed')).toEqual([`${vnToday()} column on_time missing from the output`]);
  });

  it('keeps an RO_DATABASE_URL already set, and without one or ro.env Alerts and exits 1 before any query', () => {
    expect(host(roOutput(), false).run([], { RO_DATABASE_URL: 'postgres://ideashub_ro@db/ideas_hub' }).out).toContain('passed');

    const h = host(roOutput(), false);
    const r = h.run([], { RO_DATABASE_URL: '' });
    expect(r.status).toBe(1);
    expect(h.callsOf('pnpm')).not.toContain('--silent ro-query');
    // $HOME is /c/... under Git Bash, so only the path's tail is compared.
    const missing = /RO_DATABASE_URL is not set and \S+\/home\/\.config\/ideas-hub\/ro\.env does not exist$/;
    expect(h.file('acceptance.log')).toMatch(missing);
    expect(h.alerts('acceptance_failed')).toHaveLength(1);
    expect(h.alerts('acceptance_failed')[0]).toMatch(new RegExp(`^${vnToday()} ${missing.source.slice(0, -1)}`));
  });
});
