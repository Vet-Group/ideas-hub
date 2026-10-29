import { ANGLES_TIME, ANGLE_BATCH, ANGLE_MAX_ATTEMPTS, ANGLE_MAX_TOKENS, anglePrompt, estimateCallUsd, perAdUsd, vietnamDate, vietnamInstant } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAnglesJob, scheduleAngles, tagAngles } from '../src/angles';
import { type LlmClient, type LlmRequest, llmFromEnv } from '../src/llm';
import { ANGLES, BRIEFING } from '../src/queues';
import { type Harness, all, harness, one, setSettings } from './helpers';

// 20:00 UTC on 6/11 is 03:00 on 7/11 in Asia/Ho_Chi_Minh: tagged_on must be the Vietnam date.
const START = '2026-11-06T20:00:00Z';
const TODAY = '2026-11-07';

/** A model that tags every ad it is sent with `angle`; `reply` overrides the text. */
function angleLlm(angle = 'pain', reply?: (req: LlmRequest) => string) {
  const calls: LlmRequest[] = [];
  const client: LlmClient = {
    complete: async (req) => {
      calls.push(req);
      if (reply) return reply(req);
      const ids = [...req.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
      return JSON.stringify({ angles: ids.map((id) => ({ id, angle })) });
    },
  };
  return { client, calls };
}

describe.skipIf(!testDatabaseAvailable())('angles.tag', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness(START);
    // 30 proven ads (6+ variants), oldest seen first, and 2 that are not proven.
    for (let i = 0; i < 30; i++) {
      await h.db.execute(sql`insert into ads (ad_archive_id, caption, collation_count, first_seen_date, last_seen_date, parsed)
        values (${`p${String(i).padStart(2, '0')}`}, ${`caption ${i}`}, 6, '2026-10-01', ${`2026-10-${String(i + 1).padStart(2, '0')}`}, '{}')`);
    }
    await h.db.execute(sql`insert into ads (ad_archive_id, collation_count, first_seen_date, last_seen_date, parsed) values
      ('n1', 5, '2026-10-01', '2026-11-01', '{}'), ('n2', null, '2026-10-01', '2026-11-01', '{}')`);
  }, 120_000);
  afterAll(() => h?.close());
  beforeEach(async () => {
    h.clock.t = Date.parse(START);
    await h.db.execute(sql`delete from ad_angles`);
    await h.db.execute(sql`delete from briefings`);
    await h.db.execute(sql`delete from pgboss.job where name in (${BRIEFING}, ${ANGLES})`);
    await setSettings(h, { aiDailyCostCapUsd: 3, llmModel: 'claude-sonnet-5-5' });
  });

  /** The cost the first call (p29…p05) reserves. */
  const firstCallUsd = () =>
    perAdUsd(
      estimateCallUsd('claude-sonnet-5-5', anglePrompt(Array.from({ length: ANGLE_BATCH }, (_, i) => ({ adArchiveId: `p${29 - i}`, pageName: null, caption: `caption ${29 - i}`, title: null }))), ANGLE_MAX_TOKENS),
      ANGLE_BATCH,
    ) * ANGLE_BATCH;
  const rows = () => all<{ ad_archive_id: string; angle: string; model: string; cost_usd: string; tagged_on: string; tagged_at: Date | null; attempts: number }>(
    h,
    sql`select ad_archive_id, angle, model, cost_usd, tagged_on::text, tagged_at, attempts from ad_angles order by ad_archive_id`,
  );

  it('tags the proven ads only, 25 a call, with the settings model, its cost on the Vietnam date', async () => {
    const llm = angleLlm('proof');
    expect(await tagAngles(h, llm.client)).toEqual({ outcome: 'done', calls: 2, tagged: 30 });
    expect(llm.calls.map((c) => [c.model, c.maxTokens])).toEqual([
      ['claude-sonnet-5-5', ANGLE_MAX_TOKENS],
      ['claude-sonnet-5-5', ANGLE_MAX_TOKENS],
    ]);
    const r = await rows();
    expect(r.map((x) => x.ad_archive_id)).toEqual(Array.from({ length: 30 }, (_, i) => `p${String(i).padStart(2, '0')}`));
    expect(new Set(r.map((x) => `${x.angle} ${x.model} ${x.tagged_on}`))).toEqual(new Set([`proof claude-sonnet-5-5 ${TODAY}`]));
    expect(r.every((x) => x.tagged_at !== null)).toBe(true);
    expect(vietnamDate(h.clock.now())).toBe(TODAY);
    // The most recently seen first: the first call had p29…p05.
    expect(llm.calls[0]!.user).toContain('"id":"p29"');
    expect(llm.calls[0]!.user).not.toContain('"id":"p04"');
    expect(Number(r.find((x) => x.ad_archive_id === 'p29')!.cost_usd) * ANGLE_BATCH).toBeCloseTo(firstCallUsd(), 10);
    // A second run has nothing left to tag.
    expect(await tagAngles(h, llm.client)).toEqual({ outcome: 'done', calls: 0, tagged: 0 });
  });

  it('skips while a briefing of today is not ready', async () => {
    await h.db.execute(sql`insert into briefings (id, date, scope) values ('brf_g', ${TODAY}, 'global')`);
    const llm = angleLlm();
    expect(await tagAngles(h, llm.client)).toEqual({ outcome: 'briefings_pending', calls: 0, tagged: 0 });
    expect(llm.calls).toHaveLength(0);
    expect(await rows()).toEqual([]);
    // Yesterday's unready row does not hold it back once today's is ready.
    await h.db.execute(sql`update briefings set ready_at = now() where id = 'brf_g'`);
    await h.db.execute(sql`insert into briefings (id, date, scope) values ('brf_y', '2026-11-06', 'global')`);
    expect((await tagAngles(h, llm.client)).outcome).toBe('done');
  });

  for (const state of ['created', 'retry', 'active'] as const) {
    it(`skips while a briefing build of today is ${state} in pg-boss, even before its row exists`, async () => {
      const id = await h.boss.send(BRIEFING, { date: TODAY, scope: 'keyword', keywordId: 'kw_x' }, { singletonKey: `${TODAY}:kw:kw_x`, startAfter: vietnamInstant(TODAY, '06:30') });
      await h.db.execute(sql`update pgboss.job set state = ${state} where id = ${id}`);
      const llm = angleLlm();
      expect(await tagAngles(h, llm.client)).toEqual({ outcome: 'briefings_pending', calls: 0, tagged: 0 });
      expect(llm.calls).toHaveLength(0);
      // A finished build does not.
      await h.db.execute(sql`update pgboss.job set state = 'completed' where id = ${id}`);
      expect((await tagAngles(h, llm.client)).outcome).toBe('done');
    });
  }

  it('stops at the daily cap, counting what the briefings of today spent', async () => {
    await h.db.execute(sql`insert into briefings (id, date, scope, ai_cost_usd, ready_at) values ('brf_g', ${TODAY}, 'global', 0.05, now())`);
    const llm = angleLlm();
    // Room for the first call of 25 only.
    await setSettings(h, { aiDailyCostCapUsd: 0.05 + firstCallUsd() * 1.5 });
    expect(await tagAngles(h, llm.client)).toEqual({ outcome: 'cap', calls: 1, tagged: 25 });
    const { usd } = await one<{ usd: number }>(
      h,
      sql`select (select sum(ai_cost_usd) from briefings where date = ${TODAY}) + (select sum(cost_usd) from ad_angles where tagged_on = ${TODAY}) as usd`,
    );
    const cap = (await one<{ value: number }>(h, sql`select value from settings where key = 'aiDailyCostCapUsd'`)).value;
    expect(Number(usd)).toBeLessThanOrEqual(cap);
    // Nothing fits once the cap is spent.
    await setSettings(h, { aiDailyCostCapUsd: 0.05 });
    await h.db.execute(sql`delete from ad_angles`);
    expect(await tagAngles(h, llm.client)).toEqual({ outcome: 'cap', calls: 0, tagged: 0 });
  });

  it('a failed or rejected call keeps its cost, ends the job and leaves its ads untagged', async () => {
    const bad = angleLlm('pain', () => '{"angles":[{"id":"p29","angle":"fear"}]}');
    expect(await tagAngles(h, bad.client)).toEqual({ outcome: 'failed', calls: 1, tagged: 0 });
    let r = await rows();
    expect(r).toHaveLength(ANGLE_BATCH);
    expect(r.every((x) => x.angle === 'unclear' && x.tagged_at === null && Number(x.cost_usd) > 0)).toBe(true);
    const down: LlmClient = { complete: async () => Promise.reject(new Error('503')) };
    expect(await tagAngles(h, down)).toEqual({ outcome: 'failed', calls: 1, tagged: 0 });
    r = await rows();
    expect(r).toHaveLength(30);
    // Without an LLM key nothing is reserved.
    await h.db.execute(sql`delete from ad_angles`);
    expect(await tagAngles(h, llmFromEnv({}))).toEqual({ outcome: 'unconfigured', calls: 0, tagged: 0 });
    expect(await rows()).toEqual([]);
  });

  it('a failed call is sent again on a later day, after the new ads, its cost moved to that day', async () => {
    const down: LlmClient = { complete: async () => Promise.reject(new Error('503')) };
    expect(await tagAngles(h, down)).toEqual({ outcome: 'failed', calls: 1, tagged: 0 });
    // The same day it is not sent again.
    const ok = angleLlm('proof');
    expect(await tagAngles(h, ok.client)).toEqual({ outcome: 'done', calls: 1, tagged: 5 });
    expect(ok.calls[0]!.user).toContain('"id":"p04"');
    expect(ok.calls[0]!.user).not.toContain('"id":"p29"');
    // The next day: retried, counted once, against the new day only.
    h.clock.advance(86_400_000);
    const next = vietnamDate(h.clock.now());
    expect(await tagAngles(h, ok.client)).toEqual({ outcome: 'done', calls: 1, tagged: 25 });
    const r = await rows();
    expect(r.every((x) => x.angle === 'proof' && x.tagged_at !== null)).toBe(true);
    const retried = r.filter((x) => x.ad_archive_id >= 'p05');
    expect(retried).toHaveLength(25);
    expect(new Set(retried.map((x) => `${x.tagged_on} ${x.attempts}`))).toEqual(new Set([`${next} 2`]));
    expect(r.filter((x) => x.ad_archive_id < 'p05').every((x) => x.tagged_on === TODAY && x.attempts === 1)).toBe(true);
    // The failed call's cost left the first day: it now counts against the day of the retry.
    const usd = async (d: string) => Number((await one<{ usd: string }>(h, sql`select sum(cost_usd) as usd from ad_angles where tagged_on = ${d}`)).usd);
    expect(await usd(next)).toBeCloseTo(firstCallUsd(), 4);
    expect(await usd(TODAY)).toBeLessThan(firstCallUsd());
  });

  it(`stops sending an ad after ${ANGLE_MAX_ATTEMPTS} failed calls`, async () => {
    const down: LlmClient = { complete: async () => Promise.reject(new Error('503')) };
    for (let day = 0; day < 3; day++) {
      expect(await tagAngles(h, down)).toEqual({ outcome: 'failed', calls: 1, tagged: 0 });
      h.clock.advance(86_400_000);
    }
    // Day 1 sent the 5 new ads first, then 20 retries; day 2 the 25 most recently seen retries.
    const attempts = new Map((await rows()).map((x) => [x.ad_archive_id, x.attempts]));
    expect([attempts.get('p29'), attempts.get('p10'), attempts.get('p09'), attempts.get('p05'), attempts.get('p04'), attempts.get('p00')]).toEqual([3, 3, 2, 2, 1, 1]);
    // Day 3: the ads tried 3 times are not sent again.
    const ok = angleLlm('proof');
    expect(await tagAngles(h, ok.client)).toEqual({ outcome: 'done', calls: 1, tagged: 10 });
    expect(ok.calls[0]!.user).not.toContain('"id":"p10"');
    expect((await rows()).filter((x) => x.tagged_at === null).map((x) => x.ad_archive_id)).toHaveLength(20);
  });

  it('an ad the reply leaves out is stored as unclear', async () => {
    const llm = angleLlm('pain', (req) => (req.user.includes('"id":"p29"') ? '{"angles":[{"id":"p29","angle":"identity"}]}' : '{"angles":[]}'));
    expect(await tagAngles(h, llm.client)).toMatchObject({ outcome: 'done', tagged: 30 });
    const r = await rows();
    expect(r.find((x) => x.ad_archive_id === 'p29')!.angle).toBe('identity');
    expect(r.filter((x) => x.angle === 'unclear')).toHaveLength(29);
  });

  it('while briefings are pending the job sends itself again 30 min later, the last start at 12:00', async () => {
    await h.db.execute(sql`insert into briefings (id, date, scope) values ('brf_g', ${TODAY}, 'global')`);
    const later = () => all<{ singleton_key: string; start_after: string }>(h, sql`select singleton_key, start_after from pgboss.job where name = ${ANGLES} order by start_after`);
    h.clock.t = vietnamInstant(TODAY, ANGLES_TIME).getTime();
    expect(await runAnglesJob(h, angleLlm().client, TODAY)).toEqual({ outcome: 'briefings_pending', calls: 0, tagged: 0, resent: true });
    expect((await later()).map((j) => new Date(j.start_after).toISOString())).toEqual([vietnamInstant(TODAY, '09:30').toISOString()]);
    // The job of 11:30 still sends one at 12:00; the one of 11:31 gives up for the day.
    h.clock.t = vietnamInstant(TODAY, '11:30').getTime();
    expect((await runAnglesJob(h, angleLlm().client, TODAY)).resent).toBe(true);
    h.clock.t = vietnamInstant(TODAY, '11:31').getTime();
    expect((await runAnglesJob(h, angleLlm().client, TODAY)).resent).toBe(false);
    expect((await later()).map((j) => new Date(j.start_after).toISOString())).toEqual([vietnamInstant(TODAY, '09:30').toISOString(), vietnamInstant(TODAY, '12:00').toISOString()]);
    // Other outcomes send nothing.
    await h.db.execute(sql`delete from pgboss.job where name = ${ANGLES}`);
    await h.db.execute(sql`update briefings set ready_at = now()`);
    h.clock.t = vietnamInstant(TODAY, '09:30').getTime();
    expect(await runAnglesJob(h, angleLlm().client, TODAY)).toMatchObject({ outcome: 'done', resent: false });
    expect(await later()).toEqual([]);
  });

  it('the scheduler queues one job for the next 09:00 in Asia/Ho_Chi_Minh', async () => {
    const jobs = () => all<{ singleton_key: string; start_after: string }>(h, sql`select singleton_key, start_after from pgboss.job where name = ${ANGLES} order by start_after`);
    // 03:00 on 7/11: today's 09:00.
    expect(await scheduleAngles(h, h.clock.now())).not.toBeNull();
    expect(await scheduleAngles(h, h.clock.now())).toBeNull();
    // 09:30 on 7/11: tomorrow's.
    await scheduleAngles(h, vietnamInstant(TODAY, '09:30'));
    expect((await jobs()).map((j) => [j.singleton_key, new Date(j.start_after).toISOString()])).toEqual([
      [TODAY, vietnamInstant(TODAY, ANGLES_TIME).toISOString()],
      ['2026-11-08', vietnamInstant('2026-11-08', ANGLES_TIME).toISOString()],
    ]);
  });
});
