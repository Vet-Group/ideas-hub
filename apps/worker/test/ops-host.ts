// The fake host the ops-script suites share (deploy.test.ts, backup.test.ts): a temporary git repo with
// fake gh, systemctl, pnpm, docker, curl, psql, pg_dump, pg_restore, pgrep, sleep, df and date on PATH
// (deploy-fake.sh), and a HOME of its own. Runs with bash on Linux (CI) and Git Bash on Windows.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const posix = (p: string) => p.replace(/\\/g, '/');
const here = dirname(fileURLToPath(import.meta.url));
export const scriptPath = (name: string) => posix(join(here, '../../../scripts/linux', name));
const fakeSource = readFileSync(join(here, 'deploy-fake.sh'), 'utf8');
const FAKES = ['gh', 'systemctl', 'pnpm', 'docker', 'curl', 'psql', 'pg_dump', 'pg_restore', 'dropdb', 'createdb', 'pgrep', 'sleep', 'df', 'date', 'ss'];
// Git Bash's bash on Windows (the bin/bash.exe above git.exe), not WSL's bash.exe from System32.
function gitBash(): string {
  for (let d = dirname(execFileSync('where', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0]!); d !== dirname(d); d = dirname(d)) {
    if (existsSync(join(d, 'bin', 'bash.exe'))) return join(d, 'bin', 'bash.exe');
  }
  throw new Error('Git Bash not found');
}
export const bash = process.platform === 'win32' ? gitBash() : 'bash';
const hasFlock = spawnSync(bash, ['-c', 'command -v flock']).status === 0;

export const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();

export interface Run {
  status: number | null;
  out: string;
}

export class Host {
  root = posix(mkdtempSync(join(tmpdir(), 'ih-deploy-')));
  origin = `${this.root}/origin.git`;
  work = `${this.root}/work`;
  repo = `${this.root}/repo`;
  home = `${this.root}/home`;
  fake = `${this.root}/fake`;
  bin = `${this.root}/bin`;
  state = `${this.root}/home/.local/state/ideas-hub`;
  old = '';

  constructor(
    files: Record<string, string> = {},
    readonly script = scriptPath('ideashub-deploy'),
  ) {
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

  run(args: string[] = [], env: Record<string, string> = {}, file = this.script): Run {
    // The fakes go first inside bash: Git Bash's bin/bash.exe puts its own /usr/bin (curl, sleep) in front.
    const inner = 'PATH="$(cygpath -u "$1" 2>/dev/null || echo "$1"):$PATH"; shift; exec "$BASH" "$@"';
    const r = spawnSync(bash, ['-c', inner, 'bash', this.bin, file, ...args], {
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
  /** The ops Alerts written, as `<dedupe_key> <detail>`. */
  alerts = (kind = 'deploy_failed') =>
    this.callsOf('pnpm')
      .filter((l) => l.startsWith(`--silent ops:alert ${kind} `))
      .map((l) => l.slice(`--silent ops:alert ${kind} `.length));
  unit = (u: string) => (existsSync(`${this.fake}/units/${u}`) ? readFileSync(`${this.fake}/units/${u}`, 'utf8').trim() : 'active');
  file = (name: string) => (existsSync(`${this.state}/${name}`) ? readFileSync(`${this.state}/${name}`, 'utf8').trim() : null);
  dumps = () => (existsSync(`${this.state}/predeploy`) ? readdirSync(`${this.state}/predeploy`).sort() : []);
  quiet = (...lines: string[]) => writeFileSync(`${this.fake}/quiet`, lines.join('\n') + '\n');
  reset() {
    rmSync(`${this.fake}/calls.log`, { force: true });
    rmSync(`${this.fake}/quiet.n`, { force: true });
  }
  close = () => rmSync(this.root, { recursive: true, force: true });
}
