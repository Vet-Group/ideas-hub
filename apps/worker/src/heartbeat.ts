// Worker heartbeat (spec §1 "Heartbeat"): written from the crawl loop and its waits while a crawl job
// runs, and by a one-minute idle timer between runs while pg-boss still polls.
import { sql } from 'drizzle-orm';
import { type Db } from '@ideas-hub/db/client';
import { type Clock } from './context';
import { CRAWL } from './queues';

const MINUTE = 60_000;
/** The idle timer writes only while the crawl.run worker fetched within this long. */
export const POLLING_FRESH_MS = 2 * MINUTE;

export async function writeHeartbeat(db: Db, clock: Clock) {
  await db.execute(sql`update crawler_state set heartbeat_at = ${clock.now()} where id = 1`);
}

/** Waits `ms`, writing the heartbeat at least once a minute (pauses, network cool-down, search gaps). */
export async function sleepWithBeats(ms: number, sleep: (ms: number) => Promise<void>, beat: () => Promise<void>) {
  let left = Math.max(0, ms);
  while (left > 0) {
    const step = Math.min(left, MINUTE);
    await sleep(step);
    left -= step;
    await beat();
  }
}

export interface WipEntry {
  name: string;
  lastFetchedOn: number | null;
}

/**
 * True while pg-boss still polls crawl.run: its worker fetched within 2 min (pg-boss 12.37.0 sets
 * lastFetchedOn after each fetch, dist/worker.js line 65). A missing entry or a null value is not polling.
 */
export function crawlPolling(wip: readonly WipEntry[], now: number): boolean {
  const w = wip.find((e) => e.name === CRAWL);
  return !!w?.lastFetchedOn && now - w.lastFetchedOn < POLLING_FRESH_MS;
}

/** The idle timer: started while no crawl.run job is active, stopped when one starts. */
export class IdleHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private deps: {
      wip: () => readonly WipEntry[];
      clock: Clock;
      write: () => Promise<void>;
      setInterval?: typeof setInterval;
      clearInterval?: typeof clearInterval;
    },
  ) {}

  /** One timer tick; exposed for tests. */
  async tick() {
    if (crawlPolling(this.deps.wip(), this.deps.clock.now().getTime())) await this.deps.write();
  }

  start() {
    if (this.timer) return;
    this.timer = (this.deps.setInterval ?? setInterval)(() => void this.tick().catch(() => {}), MINUTE);
  }

  stop() {
    if (!this.timer) return;
    (this.deps.clearInterval ?? clearInterval)(this.timer);
    this.timer = null;
  }

  get running() {
    return this.timer !== null;
  }
}
