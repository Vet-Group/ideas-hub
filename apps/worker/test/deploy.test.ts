// scripts/linux/ideashub-deploy in a temporary git repo, with fake gh, systemctl, pnpm, docker, curl,
// psql, pg_dump, pg_restore, pgrep and sleep on PATH (deploy-fake.sh): one case per branch of phase 2
// plan Step 2a. Runs with bash on Linux (CI) and Git Bash on Windows. The integration case at the end
// restores a real dump on a disposable database through `docker exec` into the Postgres container named
// by IDEASHUB_TEST_PG_CONTAINER (CI sets the service container's id).
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const posix = (p: string) => p.replace(/\\/g, '/');
const here = dirname(fileURLToPath(import.meta.url));
const script = posix(join(here, '../../../scripts/linux/ideashub-deploy'));
const fakeSource = readFileSync(join(here, 'deploy-fake.sh'), 'utf8');
const migrationsDir = join(here, '../../../packages/db/migrations');
const FAKES = ['gh', 'systemctl', 'pnpm', 'docker', 'curl', 'psql', 'pg_dump', 'pg_restore', 'dropdb', 'createdb', 'pgrep', 'sleep'];
// Git Bash's bash on Windows (the bin/bash.exe above git.exe), not WSL's bash.exe from System32.
function gitBash(): string {
  for (let d = dirname(execFileSync('where', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0]!); d !== dirname(d); d = dirname(d)) {
    if (existsSync(join(d, 'bin', 'bash.exe'))) return join(d, 'bin', 'bash.exe');
  }
  throw new Error('Git Bash not found');
}
const bash = process.platform === 'win32' ? gitBash() : 'bash';
const hasFlock = spawnSync(bash, ['-c', 'command -v flock']).status === 0;
const UNITS = ['ideashub-watchdog.timer', 'ideashub-worker', 'ideashub-web'];
const HOUR_S = 3600;

const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();

interface Run {
  status: number | null;
  out: string;
}

class Host {
  root = posix(mkdtempSync(join(tmpdir(), 'ih-deploy-')));
  origin = `${this.root}/origin.git`;
  work = `${this.root}/work`;
  repo = `${this.root}/repo`;
  home = `${this.root}/home`;
  fake = `${this.root}/fake`;
  bin = `${this.root}/bin`;
  state = `${this.root}/home/.local/state/ideas-hub`;
  old = '';

  constructor(files: Record<string, string> = {}) {
    for (const d of [this.home, `${this.fake}/units`, this.bin]) mkdirSync(d, { recursive: true });
    for (const f of [...FAKES, ...(hasFlock ? [] : ['flock'])]) {
      writeFileSync(`${this.bin}/${f}`, fakeSource);
      chmodSync(`${this.bin}/${f}`, 0o755);
    }
    git(this.root, ['init', '-q', '--bare', '-b', 'main', this.origin]);
    git(this.root, ['clone', '-q', this.origin, this.work]);
    git(this.work, ['checkout', '-q', '-b', 'main']);
    this.old = this.commit({ 'docker-compose.yml': 'services: {}\n', 'packages/db/migrations/0000_init.sql': 'select 1;\n', ...files });
    git(this.root, ['clone', '-q', '-b', 'main', this.origin, this.repo]);
    git(this.repo, ['config', 'core.autocrlf', 'false']);
  }

  /** A commit on origin/main; `ageSeconds` back-dates it (the CI-pending clock). */
  commit(files: Record<string, string>, ageSeconds = 0): string {
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(dirname(`${this.work}/${p}`), { recursive: true });
      writeFileSync(`${this.work}/${p}`, body);
    }
    const date = `${Math.floor(Date.now() / 1000) - ageSeconds} +0000`;
    git(this.work, ['add', '-A']);
    git(this.work, ['commit', '-q', '--allow-empty', '-m', 'change'], { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
    git(this.work, ['push', '-q', 'origin', 'main']);
    return git(this.work, ['rev-parse', 'HEAD']);
  }

  run(args: string[] = [], env: Record<string, string> = {}): Run {
    // The fakes go first inside bash: Git Bash's bin/bash.exe puts its own /usr/bin (curl, sleep) in front.
    const inner = 'PATH="$(cygpath -u "$1" 2>/dev/null || echo "$1"):$PATH"; shift; exec "$BASH" "$@"';
    const r = spawnSync(bash, ['-c', inner, 'bash', this.bin, script, ...args], {
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        HOME: this.home,
        FAKE: this.fake,
        IDEASHUB_REPO: this.repo,
        IDEASHUB_REPO_SLUG: 'test/ideas-hub',
        ...env,
      },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  head = () => git(this.repo, ['rev-parse', 'HEAD']);
  calls = () => (existsSync(`${this.fake}/calls.log`) ? readFileSync(`${this.fake}/calls.log`, 'utf8').trim().split('\n') : []);
  /** The fake calls of one command, without the command name. */
  callsOf = (name: string) => this.calls().filter((l) => l.startsWith(`${name} `)).map((l) => l.slice(name.length + 1));
  alerts = () => this.callsOf('pnpm').filter((l) => l.startsWith('--silent ops:alert ')).map((l) => l.slice('--silent ops:alert deploy_failed '.length));
  unit = (u: string) => (existsSync(`${this.fake}/units/${u}`) ? readFileSync(`${this.fake}/units/${u}`, 'utf8').trim() : 'active');
  units = () => UNITS.map(this.unit);
  file = (name: string) => (existsSync(`${this.state}/${name}`) ? readFileSync(`${this.state}/${name}`, 'utf8').trim() : null);
  dumps = () => (existsSync(`${this.state}/predeploy`) ? readdirSync(`${this.state}/predeploy`).sort() : []);
  quiet = (...lines: string[]) => writeFileSync(`${this.fake}/quiet`, lines.join('\n') + '\n');
  reset() {
    rmSync(`${this.fake}/calls.log`, { force: true });
    rmSync(`${this.fake}/quiet.n`, { force: true });
  }
  close = () => rmSync(this.root, { recursive: true, force: true });
}

const ALL_ACTIVE = ['active', 'active', 'active'];
const hosts: Host[] = [];
const host = (files?: Record<string, string>) => {
  const h = new Host(files);
  hosts.push(h);
  return h;
};
afterAll(() => hosts.forEach((h) => h.close()));

describe('ideashub-deploy', () => {
  it('passes bash -n', () => {
    expect(spawnSync(bash, ['-n', script]).status).toBe(0);
  });

  it('does nothing without a new commit', () => {
    const h = host();
    const r = h.run();
    expect(r.status, r.out).toBe(0);
    expect(h.callsOf('gh')).toEqual([]);
    expect(h.callsOf('systemctl')).toEqual([]);
    expect(h.head()).toBe(h.old);
  });

  it('--check reports a new commit by its exit code', () => {
    const h = host();
    expect(h.run(['--check']).status).toBe(1);
    h.commit({ 'a.txt': 'a' });
    expect(h.run(['--check']).status).toBe(0);
    expect(h.head()).toBe(h.old);
  });

  it('deploys a green commit: stop, dump, migrate, start, health, deployed-sha', () => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    const r = h.run();
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`deployed ${sha}`);
    expect(h.head()).toBe(sha);
    expect(h.file('deployed-sha')).toBe(sha);
    expect(h.units()).toEqual(ALL_ACTIVE);
    expect(h.alerts()).toEqual([]);
    const flow = [
      'pnpm --filter @ideas-hub/web build',
      'systemctl --user stop ideashub-watchdog.timer',
      'systemctl --user stop ideashub-worker',
      'systemctl --user stop ideashub-web',
      'pg_dump',
      'pnpm db:migrate',
      'systemctl --user start ideashub-web',
      'systemctl --user start ideashub-worker',
      'systemctl --user start ideashub-watchdog.timer',
      'curl',
    ];
    expect(h.calls().map((l) => flow.find((f) => l.startsWith(f))).filter(Boolean)).toEqual(flow);
    expect(h.calls().some((l) => l.includes('crawler_state'))).toBe(true);
    expect(h.dumps()).toEqual([expect.stringMatching(new RegExp(`^${sha}-\\d{8}T\\d{6}Z\\.dump$`))]);
    expect(h.callsOf('gh')[0]).toContain(`repos/test/ideas-hub/actions/runs?head_sha=${sha}&branch=main`);
    // Nothing new: the next tick does nothing.
    h.reset();
    expect(h.run().status).toBe(0);
    expect(h.callsOf('systemctl')).toEqual([]);
  });

  it('runs docker compose up only when docker-compose.yml changed', () => {
    const h = host();
    h.commit({ 'a.txt': 'a' });
    h.run();
    expect(h.callsOf('docker').filter((l) => l.includes(' up '))).toEqual([]);
    h.reset();
    h.commit({ 'docker-compose.yml': 'services: { postgres: {} }\n' });
    const r = h.run();
    expect(r.status, r.out).toBe(0);
    expect(h.callsOf('docker').filter((l) => l.includes(' up '))).toEqual([expect.stringContaining('-p ideas-hub -f')]);
    const calls = h.calls();
    expect(calls.findIndex((l) => l.startsWith('docker') && l.includes(' up '))).toBeLessThan(calls.indexOf('pnpm db:migrate'));
  });

  it('waits for a pending CI run and Alerts once it has waited 60 minutes', () => {
    const h = host();
    const fresh = h.commit({ 'a.txt': 'a' }, 10 * 60);
    for (const pending of ['none', 'queued null', 'in_progress null']) {
      expect(h.run([], { FAKE_GH: pending }).status).toBe(0);
    }
    expect(h.head()).toBe(h.old);
    expect(h.alerts()).toEqual([]);
    const stale = h.commit({ 'b.txt': 'b' }, 2 * HOUR_S);
    expect(h.run([], { FAKE_GH: 'in_progress null' }).status).toBe(0);
    expect(h.alerts()).toEqual([`${stale}:ci-pending no finished CI run for ${stale.slice(0, 8)} after 60 minutes`]);
    expect(fresh).not.toBe(stale);
    expect(h.head()).toBe(h.old);
  });

  it.each(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required'])('does not deploy a CI conclusion of %s and Alerts it', (conclusion) => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    const r = h.run([], { FAKE_GH: `completed ${conclusion}` });
    expect(r.status, r.out).toBe(0);
    expect(h.head()).toBe(h.old);
    expect(h.alerts()).toEqual([`${sha}:ci CI ${conclusion} on ${sha.slice(0, 8)}`]);
    expect(h.callsOf('systemctl')).toEqual([]);
    expect(h.file('failed-sha')).toBeNull();
    // A re-run that turns green deploys the same commit.
    expect(h.run().status).toBe(0);
    expect(h.head()).toBe(sha);
  });

  it('--ci-status prints the verdict and deploys nothing', () => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    git(h.repo, ['fetch', '-q']);
    expect(h.run(['--ci-status', sha.slice(0, 7)], { FAKE_GH: 'completed failure' }).out).toContain('failure, not deployed');
    expect(h.run(['--ci-status', sha], { FAKE_GH: 'completed success' }).out).toContain('success, deployable');
    expect(h.run(['--ci-status', sha], { FAKE_GH: 'in_progress null' }).out).toContain('pending, not deployed yet');
    expect(h.head()).toBe(h.old);
    expect(h.callsOf('gh')[0]).toContain(`head_sha=${sha}&`);
  });

  it('fails closed with an Alert when the token is rejected', () => {
    const h = host();
    h.commit({ 'a.txt': 'a' });
    const r = h.run([], { FAKE_GH_ERR: 'gh: Bad credentials (HTTP 401)' });
    expect(r.status, r.out).toBe(1);
    expect(h.alerts()).toEqual([expect.stringMatching(/^token:\d{4}-\d{2}-\d{2} deploy token rejected$/)]);
    expect(h.head()).toBe(h.old);
    expect(h.run([], { FAKE_GH_ERR: 'HTTP 403: Resource not accessible' }).status).toBe(1);
  });

  it('skips the tick while POD Studio deploys', () => {
    const h = host();
    h.commit({ 'a.txt': 'a' });
    const r = h.run([], { FAKE_PGREP: '0' });
    expect(r.status).toBe(0);
    expect(r.out).toContain("POD Studio's deploy is running");
    expect(h.callsOf('gh')).toEqual([]);
    expect(h.head()).toBe(h.old);
  });

  it('refuses a dirty checkout with an Alert', () => {
    const h = host();
    h.commit({ 'a.txt': 'a' });
    writeFileSync(`${h.repo}/docker-compose.yml`, 'edited by hand\n');
    expect(h.run().status).toBe(1);
    expect(h.alerts()).toEqual([expect.stringMatching(/^checkout:\d{4}-\d{2}-\d{2} /)]);
    expect(h.callsOf('gh')).toEqual([]);
  });

  it('waits while the quiet gate is closed before the build, or the database is unreachable', () => {
    const h = host();
    h.commit({ 'a.txt': 'a' });
    h.quiet('crawl run run_1 is running');
    const r = h.run();
    expect(r.status).toBe(0);
    expect(r.out).toContain('not quiet: crawl run run_1 is running');
    h.reset();
    h.quiet('down');
    expect(h.run().out).toContain('quiet gate could not read the database');
    expect(h.head()).toBe(h.old);
    expect(h.callsOf('pnpm').filter((l) => l.includes('build'))).toEqual([]);
    expect(h.callsOf('systemctl')).toEqual([]);
  });

  it('goes back to the old commit when the gate closes during the build, without an Alert', () => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    h.quiet('quiet', 'briefing build at 06:30 Asia/Ho_Chi_Minh');
    const r = h.run();
    expect(r.status, r.out).toBe(0);
    expect(h.head()).toBe(h.old);
    expect(h.alerts()).toEqual([]);
    expect(h.file('failed-sha')).toBeNull();
    expect(h.callsOf('systemctl')).toEqual(['--user try-restart ideashub-web']);
    expect(h.callsOf('pnpm').filter((l) => l.startsWith('--filter'))).toHaveLength(2);
    // The next quiet tick deploys it.
    h.reset();
    h.quiet('quiet');
    expect(h.run().status).toBe(0);
    expect(h.head()).toBe(sha);
  });

  it('goes back when the build fails, marks the commit, Alerts, and skips it until main moves', () => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    const r = h.run([], { FAKE_BUILD_FAIL: sha });
    expect(r.status, r.out).toBe(1);
    expect(h.head()).toBe(h.old);
    expect(h.file('failed-sha')).toBe(sha);
    expect(h.alerts()).toEqual([`${sha}:build deploy of ${sha.slice(0, 8)} failed at build; back to ${h.old.slice(0, 8)}.`]);
    expect(h.units()).toEqual(ALL_ACTIVE);
    expect(h.callsOf('systemctl')).toEqual(['--user try-restart ideashub-web']);
    // The alert is written after the old build and the restart.
    const calls = h.calls();
    expect(calls.findIndex((l) => l.startsWith('pnpm --silent ops:alert'))).toBeGreaterThan(calls.indexOf('systemctl --user try-restart ideashub-web'));
    h.reset();
    expect(h.run([], { FAKE_BUILD_FAIL: sha }).status).toBe(0);
    expect(h.callsOf('gh')).toEqual([]);
    const next = h.commit({ 'b.txt': 'b' });
    expect(h.run().status).toBe(0);
    expect(h.head()).toBe(next);
    expect(h.file('failed-sha')).toBeNull();
  });

  it('brings the old commit back with the real build when IDEASHUB_BUILD_CMD fails (the drill)', () => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    const r = h.run([], { IDEASHUB_BUILD_CMD: 'false' });
    expect(r.status, r.out).toBe(1);
    expect(h.head()).toBe(h.old);
    expect(h.callsOf('pnpm').filter((l) => l.startsWith('--filter'))).toEqual(['--filter @ideas-hub/web build']);
    expect(h.alerts()[0]).toMatch(new RegExp(`^${sha}:build `));
    expect(h.units()).toEqual(ALL_ACTIVE);
  });

  it('goes back when the migration fails and starts web, worker and the watchdog timer again', () => {
    const h = host();
    const sha = h.commit({ 'packages/db/migrations/0001_x.sql': 'create table x ();\n' });
    const r = h.run([], { FAKE_MIGRATE_FAIL: sha });
    expect(r.status, r.out).toBe(1);
    expect(h.head()).toBe(h.old);
    expect(h.alerts()).toEqual([`${sha}:migrate deploy of ${sha.slice(0, 8)} failed at migrate; back to ${h.old.slice(0, 8)}.`]);
    expect(h.units()).toEqual(ALL_ACTIVE);
    expect(h.file('failed-sha')).toBe(sha);
    // A failed migration leaves the schema as it was: no restore.
    expect(h.callsOf('dropdb')).toEqual([]);
    expect(h.callsOf('pg_restore')).toEqual([]);
  });

  it('restarts the old code when the dump fails, without marking the commit', () => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    const r = h.run([], { FAKE_DUMP_RC: '1' });
    expect(r.status, r.out).toBe(1);
    expect(h.head()).toBe(h.old);
    expect(h.alerts()[0]).toMatch(new RegExp(`^${sha}:dump `));
    expect(h.units()).toEqual(ALL_ACTIVE);
    expect(h.file('failed-sha')).toBeNull();
    expect(h.dumps()).toEqual([]);
    expect(h.callsOf('pnpm')).not.toContain('db:migrate');
  });

  it.each([
    ['web does not answer', { FAKE_HEALTH: '503' }],
    ['no heartbeat after the restart', { FAKE_HEARTBEAT: '0' }],
  ])('goes back without a restore when %s and no migration changed', (_, env) => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    const r = h.run([], env);
    expect(r.status, r.out).toBe(1);
    expect(h.head()).toBe(h.old);
    expect(h.alerts()).toEqual([`${sha}:health deploy of ${sha.slice(0, 8)} failed at health; back to ${h.old.slice(0, 8)}.`]);
    expect(h.units()).toEqual(ALL_ACTIVE);
    expect(h.file('failed-sha')).toBe(sha);
    expect(h.callsOf('dropdb')).toEqual([]);
  });

  it('goes back when the worker is not active after the restart', () => {
    const h = host();
    const sha = h.commit({ 'a.txt': 'a' });
    // Web answers, but the worker crashed right after its start.
    writeFileSync(`${h.bin}/curl`, `#!/usr/bin/env bash\necho inactive > "$FAKE/units/ideashub-worker"\n`);
    const r = h.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('ideashub-worker is not active');
    expect(h.alerts()[0]).toMatch(new RegExp(`^${sha}:health `));
    expect(h.head()).toBe(h.old);
    expect(h.units()).toEqual(ALL_ACTIVE);
  });

  it('after a migration change, drops, re-creates and restores the dump before the old code starts', () => {
    const h = host();
    const sha = h.commit({ 'packages/db/migrations/0001_x.sql': 'create table x ();\n' });
    const r = h.run([], { FAKE_HEALTH: '503' });
    expect(r.status, r.out).toBe(1);
    const calls = h.calls();
    const at = (p: string) => calls.findIndex((l) => l.startsWith(p));
    const [dump] = h.dumps();
    expect(h.callsOf('dropdb')).toEqual(['-U ideashub --force ideashub']);
    expect(h.callsOf('createdb')).toEqual(['-U ideashub -O ideashub ideashub']);
    expect(h.callsOf('pg_restore')).toEqual(['-U ideashub -d ideashub --no-owner --exit-on-error']);
    expect(h.callsOf('psql').filter((l) => l.includes('revoke'))).toEqual([expect.stringContaining('revoke temp on database ideashub from public')]);
    // Units stopped after the failed health check, the restore, then the old code and its start.
    const lastStop = calls.lastIndexOf('systemctl --user stop ideashub-web');
    expect(lastStop).toBeLessThan(at('dropdb'));
    expect(at('pg_restore')).toBeLessThan(calls.lastIndexOf('systemctl --user start ideashub-web'));
    expect(at('psql -U ideashub -d ideashub -AtX -v ON_ERROR_STOP=1 -c revoke')).toBeLessThan(calls.lastIndexOf('pnpm install --frozen-lockfile'));
    expect(h.units()).toEqual(ALL_ACTIVE);
    expect(h.head()).toBe(h.old);
    expect(h.alerts()[0]).toMatch(new RegExp(`^${sha}:health `));
    expect(dump).toMatch(new RegExp(`^${sha}-`));
    expect(h.file('restore-failed')).toBeNull();
  });

  it('when the restore fails: everything stays stopped, sentinel, timer disabled, Lark post, exit 2, and later runs refuse', () => {
    const h = host();
    const sha = h.commit({ 'packages/db/migrations/0001_x.sql': 'create table x ();\n' });
    const r = h.run([], { FAKE_HEALTH: '503', FAKE_RESTORE_RC: '1' });
    expect(r.status, r.out).toBe(2);
    expect(h.units()).toEqual(['inactive', 'inactive', 'inactive']);
    expect(h.unit('ideashub-deploy.timer')).toBe('disabled');
    const [dump] = h.dumps();
    expect(h.file('restore-failed')).toContain(`/.local/state/ideas-hub/predeploy/${dump} failed`);
    expect(readFileSync(`${h.fake}/lark.txt`, 'utf8')).toContain(`Deploy ${sha.slice(0, 8)}: khôi phục database thất bại`);
    expect(h.alerts()).toEqual([]);
    expect(h.head()).toBe(h.old);
    const dumpBytes = readFileSync(`${h.state}/predeploy/${dump}`, 'utf8');

    h.reset();
    h.commit({ 'b.txt': 'b' });
    const again = h.run();
    expect(again.status).toBe(2);
    expect(again.out).toContain('refusing');
    expect(h.callsOf('systemctl')).toEqual([]);
    expect(h.callsOf('gh')).toEqual([]);
    expect(h.dumps()).toEqual([dump]);
    expect(readFileSync(`${h.state}/predeploy/${dump}`, 'utf8')).toBe(dumpBytes);
  });

  it('keeps the last 3 dumps', () => {
    const h = host();
    const shas = [1, 2, 3, 4].map((i) => {
      const sha = h.commit({ [`f${i}.txt`]: String(i) });
      expect(h.run().status).toBe(0);
      return sha;
    });
    expect(h.dumps().map((d) => d.split('-')[0])).toEqual(shas.slice(1).sort());
  });

  it('--force deploys the current commit again, still behind the CI gate', () => {
    const h = host();
    expect(h.run(['--force'], { FAKE_GH: 'completed failure' }).status).toBe(0);
    expect(h.callsOf('systemctl')).toEqual([]);
    h.reset();
    const r = h.run(['--force']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`deployed ${h.old}`);
    expect(h.callsOf('pg_dump')).toHaveLength(1);
  });
});

// The plan's integration case: a migration that creates a table, a health failure, the restore; the
// table is gone, the migration journal matches, and the next migrate succeeds.
const pgContainer = process.env.IDEASHUB_TEST_PG_CONTAINER;
describe.skipIf(!testDatabaseAvailable() || !pgContainer)('ideashub-deploy restore on a real database', () => {
  let drop: (() => Promise<void>) | undefined;
  afterAll(() => drop?.());

  it('restores the predeploy dump so the new table is gone and migrate works again', async () => {
    const db = await createTestDatabase();
    drop = db.drop;
    const dbName = new URL(db.url).pathname.slice(1);
    const query = async (text: string) => {
      const c = new pg.Client({ connectionString: db.url });
      await c.connect();
      try {
        return (await c.query(text)).rows;
      } finally {
        await c.end();
      }
    };
    const journalCount = Number((await query('select count(*) as n from drizzle.__drizzle_migrations'))[0].n);

    const h = host();
    // The old commit carries the real migrations; the new one adds a migration that creates a table.
    cpSync(migrationsDir, `${h.work}/packages/db/migrations`, { recursive: true });
    h.commit({});
    git(h.repo, ['pull', '-q', '--ff-only']);
    h.old = h.head();
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; when: number }[] };
    const last = journal.entries.at(-1)!;
    const tag = `${String(last.idx + 1).padStart(4, '0')}_deploy_probe`;
    journal.entries.push({ idx: last.idx + 1, version: '7', when: last.when + 1, tag, breakpoints: true } as never);
    const sha = h.commit({
      [`packages/db/migrations/${tag}.sql`]: 'CREATE TABLE "deploy_probe" ("id" integer PRIMARY KEY);\n',
      'packages/db/migrations/meta/_journal.json': JSON.stringify(journal, null, 2),
    });

    const helper = posix(join(here, 'deploy-migrate.mjs'));
    const env = { FAKE_HEALTH: '503', FAKE_MIGRATE_HELPER: helper, FAKE_PG_EXEC: `docker exec -i ${pgContainer}`, FAKE_DB: dbName, DATABASE_URL: db.url };
    const r = h.run([], env);
    expect(r.status, r.out).toBe(1);
    expect(h.alerts()[0]).toMatch(new RegExp(`^${sha}:health `));
    expect(h.head()).toBe(h.old);

    expect(await query(`select to_regclass('public.deploy_probe') as t`)).toEqual([{ t: null }]);
    expect(Number((await query('select count(*) as n from drizzle.__drizzle_migrations'))[0].n)).toBe(journalCount);
    expect(await query(`select has_database_privilege('public', current_database(), 'TEMP') as temp`)).toEqual([{ temp: false }]);
    expect(Number((await query('select count(*) as n from settings'))[0].n)).toBeGreaterThan(0);

    // The old code's migrate is a no-op, and the new one applies cleanly on the restored journal.
    const migrate = (dir: string) => spawnSync(process.execPath, [helper, dir], { env: { ...process.env, DATABASE_URL: db.url }, encoding: 'utf8' });
    expect(migrate(`${h.repo}/packages/db/migrations`).status).toBe(0);
    expect(migrate(`${h.work}/packages/db/migrations`).status).toBe(0);
    expect(await query(`select to_regclass('public.deploy_probe')::text as t`)).toEqual([{ t: 'deploy_probe' }]);
  }, 300_000);
});
