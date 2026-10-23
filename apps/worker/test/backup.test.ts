// scripts/linux/ideashub-backup (with --drill) and scripts/linux/ideashub-sizes on the fake host of
// ops-host.ts (deploy-fake.sh): backup failure Alerts per stage, the drill's ok/DIFF lines and exit 1,
// sizes at 79/80/90% with warning and critical both sent (phase 2 plan Step 2c). No real bucket, password
// or Docker: restic and mc are answered by the fake `docker`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { bash, Host, scriptPath } from './ops-host';

const here = dirname(fileURLToPath(import.meta.url));
const compose = readFileSync(join(here, '../../../docker-compose.yml'), 'utf8');
const BACKUP = scriptPath('ideashub-backup');
const SIZES = scriptPath('ideashub-sizes');
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const ROWS = 'public.ads 3\npublic.alerts 0\ndrizzle.__drizzle_migrations 12\n';

const hosts: Host[] = [];
afterAll(() => hosts.forEach((h) => h.close()));

function host(script: string): Host {
  const h = new Host({ 'docker-compose.yml': compose }, script);
  hosts.push(h);
  writeFileSync(`${h.fake}/rows`, ROWS);
  mkdirSync(`${h.home}/.config/ideas-hub`, { recursive: true });
  writeFileSync(`${h.home}/.config/ideas-hub/restic-password`, 'not-a-real-password\n');
  return h;
}

/** The environment backup.env gives the units, with a repository that does not exist. */
const backupEnv = (h: Host, env: Record<string, string> = {}) => ({
  RESTIC_REPOSITORY: 's3:https://example.invalid/ideas-hub-test',
  RESTIC_PASSWORD_FILE: `${h.home}/.config/ideas-hub/restic-password`,
  FAKE_WEEKDAY: '3',
  ...env,
});
/** The restic calls: the arguments after the pinned image. */
const restic = (h: Host) => h.callsOf('docker').filter((l) => l.includes('restic/restic')).map((l) => l.slice(l.indexOf('restic/restic')));

describe('ideashub-backup', () => {
  it('passes bash -n', () => {
    expect(spawnSync(bash, ['-n', BACKUP]).status).toBe(0);
    expect(spawnSync(bash, ['-n', SIZES]).status).toBe(0);
  });

  it('dumps, counts, snapshots the staging directory and the MinIO volume with the pinned image, forgets', () => {
    const h = host(BACKUP);
    const r = h.run([], backupEnv(h));
    expect(r.status, r.out).toBe(0);
    expect(h.alerts('backup_failed')).toEqual([]);
    expect(h.callsOf('pg_dump')).toEqual(['-U ideashub -d ideashub -Fc']);
    expect(h.callsOf('pg_restore')).toEqual(['--data-only -f -']);
    const runs = h.callsOf('docker').filter((l) => l.includes('restic/restic'));
    expect(runs).toHaveLength(3);
    for (const l of runs) {
      expect(l).toMatch(/^run --rm --cpus 1 --memory 1g /);
      expect(l).toContain('-v ideas-hub_restic-cache:/cache');
      expect(l).toContain(':/run/restic-password:ro');
      expect(l).not.toContain('not-a-real-password');
    }
    expect(runs[1]).toContain('/home/.local/state/ideas-hub/backup-staging:/backup/staging:ro -v ideas-hub_minio-data:/backup/minio:ro ');
    expect(restic(h)).toEqual([
      expect.stringMatching(/^restic\/restic:[\d.]+@sha256:[0-9a-f]{64} cat config$/),
      expect.stringMatching(/ backup --host ideashub \/backup$/),
      expect.stringMatching(/ forget --host ideashub --keep-within 30d$/),
    ]);
    // Dump and counts before the snapshot; the staging directory is gone after a good run.
    const calls = h.calls();
    expect(calls.findIndex((l) => l.startsWith('pg_restore'))).toBeLessThan(calls.findIndex((l) => l.includes(' backup --host')));
    expect(existsSync(`${h.state}/backup-staging`)).toBe(false);
  });

  it('prunes on Sundays only', () => {
    const h = host(BACKUP);
    expect(h.run([], backupEnv(h, { FAKE_WEEKDAY: '7' })).status).toBe(0);
    expect(restic(h)[2]).toMatch(/ forget --host ideashub --keep-within 30d --prune$/);
  });

  it('writes counts.txt from the dump: rows per table and the bucket objects and bytes', () => {
    const h = host(BACKUP);
    // A snapshot failure keeps the staging directory for a look.
    const r = h.run([], backupEnv(h, { FAKE_RESTIC_FAIL: 'backup', FAKE_OBJECTS: '3' }));
    expect(r.status, r.out).toBe(1);
    expect(readFileSync(`${h.state}/backup-staging/counts.txt`, 'utf8')).toBe(
      'rows public.ads 3\nrows public.alerts 0\nrows drizzle.__drizzle_migrations 12\nobjects ideas-hub 3 300\n',
    );
    expect(h.alerts('backup_failed')).toEqual([expect.stringMatching(new RegExp(`^${DATE}:backup backup failed at backup: Fatal: backup failed \\(fake\\)$`))]);
  });

  it.each([
    ['config', {}, { OFFSITE_S3_BUCKET: 'b', OFFSITE_S3_ENDPOINT: 'https://x.invalid', OFFSITE_S3_ACCESS_KEY_ID: '' }],
    ['config', {}, { RESTIC_PASSWORD_FILE: '/nonexistent' }],
    ['config', {}, { OFFSITE_RETENTION_DAYS: '0' }],
    ['dump', { FAKE_DUMP_RC: '1' }, {}],
    ['counts', { FAKE_RESTORE_RC: '1' }, {}],
    ['forget', { FAKE_RESTIC_FAIL: 'forget' }, {}],
    ['init', { FAKE_RESTIC_FAIL: 'cat init' }, {}],
  ])('Alerts a failure at %s with its own key and exits 1', (stage, env, override) => {
    const h = host(BACKUP);
    const r = h.run([], { ...backupEnv(h, env), ...override });
    expect(r.status, r.out).toBe(1);
    expect(h.alerts('backup_failed')).toEqual([expect.stringMatching(new RegExp(`^${DATE}:${stage} backup failed at ${stage}: `))]);
    if (stage !== 'forget') expect(restic(h).filter((l) => l.includes(' forget '))).toEqual([]);
  });

  it('skips with one log line and no Alert when no off-host target is configured', () => {
    const h = host(BACKUP);
    for (const args of [[], ['--drill']]) {
      const r = h.run(args, { RESTIC_PASSWORD_FILE: '', RESTIC_REPOSITORY: '', OFFSITE_S3_ENDPOINT: '' });
      expect(r.status, r.out).toBe(0);
      expect(r.out.trim().split('\n')).toEqual([expect.stringMatching(/\[backup\] no off-host target configured/)]);
    }
    expect(h.alerts('backup_failed')).toEqual([]);
    expect(h.calls().filter((l) => !l.startsWith('date '))).toEqual([]);
  });

  it('builds the R2 repository and keys from OFFSITE_S3_*, keeps the days asked for, never puts a secret on a command line', () => {
    const h = host(BACKUP);
    const env = {
      RESTIC_REPOSITORY: '',
      OFFSITE_S3_ENDPOINT: 'https://acct.r2.example.invalid/',
      OFFSITE_S3_BUCKET: 'ih-backups',
      OFFSITE_S3_ACCESS_KEY_ID: 'test-key-id',
      OFFSITE_S3_SECRET_ACCESS_KEY: 'test-secret-value',
      OFFSITE_RETENTION_DAYS: '45',
    };
    const r = h.run([], backupEnv(h, env));
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(`${h.fake}/restic-env.log`, 'utf8').trim().split('\n')).toEqual(
      ['cat', 'backup', 'forget'].map((s) => `${s} repo=s3:https://acct.r2.example.invalid/ih-backups/ideas-hub region=auto key=set`),
    );
    expect(restic(h)[2]).toMatch(/ forget --host ideashub --keep-within 45d$/);
    expect(h.calls().join('\n')).not.toMatch(/test-key-id|test-secret-value/);
    expect(r.out).not.toMatch(/test-key-id|test-secret-value/);
  });

  it('takes the prefix and region from OFFSITE_S3_PREFIX and OFFSITE_S3_REGION', () => {
    const h = host(BACKUP);
    const env = { RESTIC_REPOSITORY: '', OFFSITE_S3_ENDPOINT: 'https://e.invalid', OFFSITE_S3_BUCKET: 'b', OFFSITE_S3_ACCESS_KEY_ID: 'k', OFFSITE_S3_SECRET_ACCESS_KEY: 's', OFFSITE_S3_PREFIX: 'prod', OFFSITE_S3_REGION: 'eu' };
    expect(h.run([], backupEnv(h, env)).status).toBe(0);
    expect(readFileSync(`${h.fake}/restic-env.log`, 'utf8')).toContain('repo=s3:https://e.invalid/b/prod region=eu key=set');
  });

  it('initialises a repository that does not exist yet, once, before the snapshot', () => {
    const h = host(BACKUP);
    const r = h.run([], backupEnv(h, { FAKE_RESTIC_FAIL: 'cat' }));
    expect(r.status, r.out).toBe(0);
    expect(restic(h).map((l) => l.split(' ')[1])).toEqual(['cat', 'init', 'backup', 'forget']);
  });

  it('keeps the staging directory and the earlier snapshots when the upload fails, and Alerts', () => {
    const h = host(BACKUP);
    const r = h.run([], backupEnv(h, { FAKE_RESTIC_FAIL: 'backup' }));
    expect(r.status, r.out).toBe(1);
    expect(existsSync(`${h.state}/backup-staging/ideashub.dump`)).toBe(true);
    expect(restic(h).filter((l) => / (forget|init) /.test(l))).toEqual([]);
    expect(h.alerts('backup_failed')).toHaveLength(1);
  });

  it('skips with an Alert while the restore-failed sentinel exists', () => {
    const h = host(BACKUP);
    mkdirSync(h.state, { recursive: true });
    writeFileSync(`${h.state}/restore-failed`, 'restore of x failed\n');
    const r = h.run([], backupEnv(h));
    expect(r.status, r.out).toBe(1);
    expect(h.alerts('backup_failed')).toEqual([expect.stringMatching(new RegExp(`^${DATE}:sentinel `))]);
    expect(h.callsOf('pg_dump')).toEqual([]);
    expect(restic(h)).toEqual([]);
  });

  it('takes the Alert key from IDEASHUB_ALERT_KEY', () => {
    const h = host(BACKUP);
    h.run([], backupEnv(h, { FAKE_DUMP_RC: '1', IDEASHUB_ALERT_KEY: 'test:1700000000' }));
    expect(h.alerts('backup_failed')).toEqual(['test:1700000000:dump backup failed at dump: pg_dump failed']);
  });
});

describe('ideashub-backup --drill', () => {
  /** A drill of a snapshot whose counts.txt holds ROWS and 2 objects; `rows` is what the restore holds. */
  const drill = (env: Record<string, string> = {}, rows = ROWS) => {
    const h = host(BACKUP);
    writeFileSync(`${h.fake}/counts.txt`, `${ROWS.trimEnd().replace(/^/gm, 'rows ')}\nobjects ideas-hub 2 200\n`);
    writeFileSync(`${h.fake}/rows`, rows);
    return { h, r: h.run(['--drill'], backupEnv(h, env)) };
  };

  it('restores the latest snapshot into a temporary database and MinIO, prints ok per line, and removes both', () => {
    const { h, r } = drill();
    expect(r.status, r.out).toBe(0);
    for (const line of ['ok   rows public.ads 3', 'ok   rows public.alerts 0', 'ok   rows drizzle.__drizzle_migrations 12', 'ok   objects ideas-hub 2 200']) {
      expect(r.out).toContain(line);
    }
    expect(h.alerts('backup_failed')).toEqual([]);
    expect(restic(h).map((l) => l.split(' ').slice(1).join(' '))).toEqual([
      'snapshots --host ideashub --latest 1 --json',
      'dump 5ca1ab1e /backup/staging/counts.txt',
      'dump 5ca1ab1e /backup/staging/ideashub.dump',
      'restore 5ca1ab1e:/backup/minio --target /target',
    ]);
    expect(h.callsOf('createdb')).toEqual(['-U ideashub -O ideashub ideashub_restore_check']);
    expect(h.callsOf('pg_restore')).toEqual(['-U ideashub -d ideashub_restore_check --no-owner --exit-on-error']);
    const minio = h.callsOf('docker').find((l) => l.startsWith('run -d --name ideas-hub-drill-minio'));
    expect(minio).toMatch(/ -v ideas-hub_drill-minio:\/data chainguard\/minio@sha256:[0-9a-f]{64} server \/data$/);
    expect(minio).not.toMatch(/ -p /);
    // Cleaned before (a killed earlier drill) and after.
    expect(h.callsOf('dropdb')).toEqual(Array(2).fill('-U ideashub --if-exists --force ideashub_restore_check'));
    expect(h.callsOf('docker').filter((l) => l === 'rm -f ideas-hub-drill-minio')).toHaveLength(2);
    expect(h.callsOf('docker').filter((l) => l === 'volume rm -f ideas-hub_drill-minio')).toHaveLength(2);
  });

  it.each([
    ['a table', {}, ROWS.replace('public.ads 3', 'public.ads 2'), 'DIFF rows public.ads restored 2, snapshot 3'],
    ['the bucket', { FAKE_DRILL_OBJECTS: '1' }, ROWS, 'DIFF objects ideas-hub restored 1 100, snapshot 2 200'],
  ])('prints DIFF, Alerts and exits 1 when %s differs, and still cleans up', (_, env, rows, line) => {
    const { h, r } = drill(env, rows);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(line);
    expect(h.alerts('backup_failed')).toEqual([expect.stringMatching(new RegExp(`^${DATE}:drill backup failed at drill: 1 line\\(s\\) of snapshot 5ca1ab1e differ`))]);
    expect(h.callsOf('dropdb')).toHaveLength(2);
    expect(h.callsOf('docker').filter((l) => l === 'volume rm -f ideas-hub_drill-minio')).toHaveLength(2);
  });

  it('fails with an Alert when the repository has no snapshot', () => {
    const { h, r } = drill({ FAKE_NO_SNAPSHOT: '1' });
    expect(r.status, r.out).toBe(1);
    expect(h.alerts('backup_failed')).toEqual([expect.stringMatching(new RegExp(`^${DATE}:drill backup failed at drill: no snapshot`))]);
    expect(h.callsOf('createdb')).toEqual([]);
  });
});

describe('ideashub-sizes', () => {
  const lines = (h: Host, f: string) => readFileSync(`${h.state}/${f}`, 'utf8').trim().split('\n');

  it('writes the sizes and peaks lines and no Alert at 79%', () => {
    const h = host(SIZES);
    const r = h.run([], { FAKE_DF_ROOT: '79', FAKE_DF_HOME: '40', FAKE_OBJECTS: '4', FAKE_DB_BYTES: '987654' });
    expect(r.status, r.out).toBe(0);
    expect(lines(h, 'sizes.csv')).toEqual(['date,db_bytes,bucket_bytes,bucket_objects,docker_root_used_pct,home_used_pct', expect.stringMatching(new RegExp(`^${DATE},987654,400,4,79,40$`))]);
    expect(lines(h, 'peaks.csv').slice(1)).toEqual(
      ['ideashub-worker', 'ideashub-web', 'ideashub-deploy'].map((u) => expect.stringMatching(new RegExp(`^${DATE}T[\\d:]+Z,${u},1048576,5000000000$`))),
    );
    expect(h.alerts('disk_space')).toEqual([]);
  });

  it('sends a warning at 80% and a critical at 90% the same day, under different keys', () => {
    const h = host(SIZES);
    expect(h.run([], { FAKE_DF_ROOT: '80' }).status).toBe(0);
    expect(h.run([], { FAKE_DF_ROOT: '90' }).status).toBe(0);
    expect(h.alerts('disk_space')).toEqual([
      expect.stringMatching(new RegExp(`^${DATE}:/:warning disk / at 80% used \\(warning, threshold 80%\\)$`)),
      expect.stringMatching(new RegExp(`^${DATE}:/:critical disk / at 90% used \\(critical, threshold 90%\\)$`)),
    ]);
    expect(lines(h, 'sizes.csv')).toHaveLength(3);
  });

  it('checks $HOME on its own filesystem, and once when rootless Docker keeps its data under $HOME', () => {
    const h = host(SIZES);
    h.run([], { FAKE_DF_ROOT: '10', FAKE_DF_HOME: '85' });
    expect(h.alerts('disk_space')).toEqual([expect.stringMatching(new RegExp(`^${DATE}:/home:warning `))]);
    h.reset();
    h.run([], { FAKE_DOCKER_ROOT: `${h.home}/.local/share/docker`, FAKE_DF_HOME: '95' });
    expect(h.alerts('disk_space')).toEqual([expect.stringMatching(new RegExp(`^${DATE}:/home:critical `))]);
  });

  it('takes the threshold and key from IDEASHUB_DISK_WARN_PCT and IDEASHUB_ALERT_KEY (the Step 5 check)', () => {
    const h = host(SIZES);
    h.run([], { IDEASHUB_DISK_WARN_PCT: '1', IDEASHUB_ALERT_KEY: 'test:1700000000', FAKE_DF_ROOT: '12', FAKE_DF_HOME: '12' });
    expect(h.alerts('disk_space')).toEqual(['test:1700000000:/:warning disk / at 12% used (warning, threshold 1%)', 'test:1700000000:/home:warning disk /home at 12% used (warning, threshold 1%)']);
  });

  it('still checks the disk when the database is down, leaving its field empty and exiting 1', () => {
    const h = host(SIZES);
    const r = h.run([], { FAKE_DB_DOWN: '1', FAKE_DF_ROOT: '91' });
    expect(r.status, r.out).toBe(1);
    expect(lines(h, 'sizes.csv')[1]).toMatch(new RegExp(`^${DATE},,200,2,91,50$`));
    expect(h.alerts('disk_space')).toEqual([expect.stringMatching(/:\/:critical /)]);
  });
});
