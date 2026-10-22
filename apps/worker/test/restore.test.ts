// scripts/linux/restore.sh on the fake host of ops-host.ts (deploy-fake.sh): the row-count check after a
// restore compares every table of the manifest, not only the first (`docker compose exec -T` reads stdin,
// so the loop's manifest lines must not reach it), and exits 1 on a difference.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { Host, scriptPath } from './ops-host';

const hosts: Host[] = [];
afterAll(() => hosts.forEach((h) => h.close()));

const MANIFEST_ROWS = { users: 1, ads: 3, alerts: 0 };

function restore(rows: string) {
  const h = new Host({ 'scripts/linux/restore.sh': readFileSync(scriptPath('restore.sh'), 'utf8'), '.env': 'APP_URL=https://ideas.example.test\n' });
  hosts.push(h);
  const transfer = `${h.root}/transfer`;
  mkdirSync(transfer);
  const lines = ['created 2026-10-22T13:59:34+07:00', 'git 0000000'];
  for (const f of ['ideashub.dump', 'minio-data.tgz']) {
    const body = `fake ${f}\n`;
    writeFileSync(`${transfer}/${f}`, body);
    lines.push(`sha256 ${createHash('sha256').update(body).digest('hex')} ${f} ${body.length}`);
  }
  for (const [t, n] of Object.entries(MANIFEST_ROWS)) lines.push(`rows ${t} ${n}`);
  // CRLF, as dump-windows.ps1 writes it.
  writeFileSync(`${transfer}/manifest.txt`, `${lines.join('\r\n')}\r\n`);
  writeFileSync(`${h.fake}/rows`, rows);
  return h.run(['--transfer', transfer], {}, `${h.repo}/scripts/linux/restore.sh`);
}

describe('restore.sh row counts', () => {
  it('compares every table of the manifest', () => {
    const r = restore('users 1\nads 3\nalerts 0\n');
    expect(r.out).toContain('ok   users 1');
    expect(r.out).toContain('ok   ads 3');
    expect(r.out).toContain('ok   alerts 0');
    expect(r.status).toBe(0);
  });

  it('prints DIFF and exits 1 when a later table differs', () => {
    const r = restore('users 1\nads 2\nalerts 0\n');
    expect(r.out).toContain('DIFF ads restored 2, manifest 3');
    expect(r.out).toContain('1 table(s) differ from the manifest');
    expect(r.status).toBe(1);
  });
});
