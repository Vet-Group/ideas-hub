import { describe, expect, it } from 'vitest';
import { type PacingSettings, type Signal, createPacer } from './pacing';
import { DEFAULT_SETTINGS } from './settings';

const MIN = 60_000;

function setup(overrides: Partial<PacingSettings> = {}, r = 0.5) {
  const clock = { t: 0, r };
  const pacer = createPacer({ ...DEFAULT_SETTINGS, ...overrides }, { now: () => clock.t, random: () => clock.r });
  // A neutral jitter (r = 0.5) makes pauses exact.
  return { clock, pacer, run: (signals: Signal[]) => signals.map((s) => pacer.record(s)) };
}

describe('backoff', () => {
  it('doubles the pause with the block streak', () => {
    const { run } = setup();
    expect(run(['blocked', 'blocked'])).toEqual([
      { kind: 'continue', pauseMs: 45_000 },
      { kind: 'continue', pauseMs: 90_000 },
    ]);
  });

  it('keeps jitter within ±15%', () => {
    for (const r of [0, 0.25, 0.75, 0.999_999]) {
      const d = setup({}, r).pacer.record('blocked');
      expect(d.kind).toBe('continue');
      const pause = (d as { pauseMs: number }).pauseMs;
      expect(pause).toBeGreaterThanOrEqual(45_000 * 0.85);
      expect(pause).toBeLessThanOrEqual(45_000 * 1.15);
    }
  });

  it('neither counts nor resets the block streak on neutral and network signals', () => {
    const { pacer, run } = setup();
    run(['blocked', 'neutral', 'network']);
    expect(pacer.blockStreak).toBe(1);
    expect(pacer.record('blocked')).toEqual({ kind: 'continue', pauseMs: 90_000 });
  });

  it('resets the block streak after ok', () => {
    const { run } = setup();
    expect(run(['blocked', 'ok', 'blocked']).at(-1)).toEqual({ kind: 'continue', pauseMs: 45_000 });
  });

  it('resets the block streak after 30 quiet minutes, not before', () => {
    const a = setup();
    a.pacer.record('blocked');
    a.clock.t += 29 * MIN;
    expect(a.pacer.record('blocked')).toEqual({ kind: 'continue', pauseMs: 90_000 });

    const b = setup();
    b.pacer.record('blocked');
    b.clock.t += 30 * MIN;
    expect(b.pacer.record('blocked')).toEqual({ kind: 'continue', pauseMs: 45_000 });
  });

  it('counts a network cool-down that long as quiet time', () => {
    const { clock, pacer, run } = setup({ networkCooldown: { streak: 3, minutes: 30 } });
    pacer.record('blocked');
    const cooldown = run(['network', 'network', 'network']).at(-1)!;
    expect(cooldown).toEqual({ kind: 'network_cooldown', pauseMs: 30 * MIN });
    clock.t += 30 * MIN;
    expect(pacer.record('blocked')).toEqual({ kind: 'continue', pauseMs: 45_000 });
  });

  it('stops at a block streak of 3', () => {
    expect(setup().run(['blocked', 'blocked', 'blocked']).at(-1)).toEqual({ kind: 'stop', reason: 'block_streak' });
  });

  it('stops at blocked, no_results, blocked, blocked', () => {
    expect(setup().run(['blocked', 'neutral', 'blocked', 'blocked']).at(-1)).toEqual({ kind: 'stop', reason: 'block_streak' });
  });

  it('stops at 6 blocked searches in a run', () => {
    const decisions = setup().run(['blocked', 'blocked', 'ok', 'blocked', 'blocked', 'ok', 'blocked', 'ok', 'blocked']);
    expect(decisions.slice(0, -1).every((d) => d.kind === 'continue')).toBe(true);
    expect(decisions.at(-1)).toEqual({ kind: 'stop', reason: 'blocked_searches' });
  });

  it('stops at a captcha (also sent for a login wall)', () => {
    expect(setup().pacer.record('captcha')).toEqual({ kind: 'stop', reason: 'captcha' });
  });

  it('pauses at most 362.25 s in a run that reaches its last search', () => {
    const decisions = setup({}, 0.999_999_999).run(['blocked', 'blocked', 'ok', 'blocked', 'blocked', 'ok', 'blocked', 'ok']);
    expect(decisions.every((d) => d.kind === 'continue')).toBe(true);
    const total = decisions.reduce((sum, d) => sum + (d as { pauseMs: number }).pauseMs, 0);
    expect(total).toBeLessThanOrEqual(362_250);
    expect(total).toBeGreaterThan(362_249);
  });
});

describe('network streak', () => {
  it('starts one network cool-down at 3 network_error searches in a row', () => {
    expect(setup().run(['network', 'network', 'network'])).toEqual([
      { kind: 'continue', pauseMs: 0 },
      { kind: 'continue', pauseMs: 0 },
      { kind: 'network_cooldown', pauseMs: 10 * MIN },
    ]);
  });

  it('is reset by any other search', () => {
    const decisions = setup().run(['network', 'neutral', 'network', 'network']);
    expect(decisions.some((d) => d.kind === 'network_cooldown')).toBe(false);
  });

  it('is reset after a cool-down', () => {
    const { pacer, run } = setup();
    run(['network', 'network', 'network']);
    expect(pacer.networkStreak).toBe(0);
    expect(run(['network', 'network']).every((d) => d.kind === 'continue')).toBe(true);
    expect(pacer.record('network').kind).toBe('network_cooldown');
  });
});

describe('delays', () => {
  it('stay within their ranges', () => {
    for (const r of [0, 0.5, 0.999_999]) {
      const { pacer } = setup({}, r);
      expect(pacer.searchGapMs()).toBeGreaterThanOrEqual(20_000);
      expect(pacer.searchGapMs()).toBeLessThanOrEqual(60_000);
      expect(pacer.pageDelayMs()).toBeGreaterThanOrEqual(400);
      expect(pacer.pageDelayMs()).toBeLessThanOrEqual(1300);
      expect(pacer.scrollDelayMs()).toBeGreaterThanOrEqual(900);
      expect(pacer.scrollDelayMs()).toBeLessThanOrEqual(1700);
    }
    expect(setup({}, 0).pacer.searchGapMs()).toBe(20_000);
  });
});
