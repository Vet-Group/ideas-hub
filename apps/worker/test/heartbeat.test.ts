import { describe, expect, it } from 'vitest';
import { IdleHeartbeat, crawlPolling, sleepWithBeats } from '../src/heartbeat';
import { CRAWL } from '../src/queues';
import { FakeClock } from './helpers';

const MIN = 60_000;

describe('heartbeat', () => {
  it('sleepWithBeats writes at least once a minute during a pause and a 10 min network cool-down', async () => {
    const clock = new FakeClock(0);
    const beats: number[] = [];
    await sleepWithBeats(10 * MIN + 500, async (ms) => clock.advance(ms), async () => void beats.push(clock.t));
    expect(beats).toHaveLength(11);
    expect(beats.slice(1).every((b, i) => b - beats[i]! <= MIN)).toBe(true);
  });

  it('the idle timer writes only while pg-boss still polls crawl.run (fetched within 2 min)', async () => {
    const clock = new FakeClock(10 * MIN);
    let writes = 0;
    let wip = [{ name: CRAWL, lastFetchedOn: clock.t - 2000 }];
    const idle = new IdleHeartbeat({ wip: () => wip, clock, write: async () => void (writes += 1) });
    await idle.tick();
    expect(writes).toBe(1);
    wip = [{ name: CRAWL, lastFetchedOn: clock.t - 2 * MIN }];
    await idle.tick();
    expect(writes).toBe(1);
    expect(crawlPolling([], clock.t)).toBe(false);
    expect(crawlPolling([{ name: CRAWL, lastFetchedOn: null }], clock.t)).toBe(false);
  });

  it('the idle timer runs between runs and stops while a crawl job is active, a 6 h cool-down spent idle included', () => {
    const timers: (() => void)[] = [];
    const idle = new IdleHeartbeat({
      wip: () => [],
      clock: new FakeClock(0),
      write: async () => {},
      setInterval: ((fn: () => void) => (timers.push(fn), timers.length)) as unknown as typeof setInterval,
      clearInterval: (() => timers.pop()) as unknown as typeof clearInterval,
    });
    idle.start();
    expect(idle.running).toBe(true);
    idle.stop();
    expect(idle.running).toBe(false);
    expect(timers).toHaveLength(0);
  });
});
