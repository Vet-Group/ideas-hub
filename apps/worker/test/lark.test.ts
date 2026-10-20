import { vietnamInstant } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type LarkDeps, alertSender, larkHttpClient, larkSend, larkUuid } from '../src/lark';
import { LARK, type LarkJob, jobState, sendLarkJob } from '../src/queues';
import { recoverAtStartup } from '../src/recovery';
import { runCrawl } from '../src/run';
import { watchdogPass } from '../src/watchdog-pass';
import { fakeLark } from './fakes';
import { type Harness, all, fakeSite, harness, insertRun, one, runDeps, seedKeywords, setSettings } from './helpers';

const HOUR = 3_600_000;
const MIN = 60_000;
const JOB: LarkJob = { briefingId: 'brf_g', chat: 'oc_shared' };

describe.skipIf(!testDatabaseAvailable())('Lark delivery', () => {
  let h: Harness;
  let lark: Awaited<ReturnType<typeof fakeLark>>;
  let deps: LarkDeps;
  const bossDb = () => ({ executeSql: (t: string, v?: unknown[]) => h.pool.query(t, v) });
  const signal = () => new AbortController().signal;
  const messageIds = () => all<{ message_id: string | null }>(h, sql`select message_id from lark_messages where briefing_id = 'brf_g'`);

  beforeAll(async () => {
    h = await harness('2026-10-21T00:30:00Z'); // 07:30 Asia/Ho_Chi_Minh
    lark = await fakeLark();
    deps = { lark: larkHttpClient(lark.config), appUrl: 'http://app.test' };
    await seedKeywords(h, 3);
  }, 60_000);
  afterAll(async () => {
    await lark?.close();
    await h?.close();
  });
  beforeEach(async () => {
    lark.reset();
    h.clock.t = Date.parse('2026-10-21T00:30:00Z');
    await h.db.execute(sql`truncate briefings, alerts, crawl_runs cascade`);
    await h.db.execute(sql`delete from pgboss.job where name = ${LARK}`);
    await h.db.execute(sql`delete from settings where key = 'larkSendTimeoutSeconds'`);
    await h.db.execute(sql`insert into briefings (id, date, scope, sections, ready_at) values ('brf_g', '2026-10-21', 'global', '{}', ${new Date(h.clock.t - HOUR)})`);
  });

  it('a lark.send retry reuses the same uuid, and a post over its timeout is retried by lark.send', async () => {
    await setSettings(h, { larkSendTimeoutSeconds: 0.3 });
    lark.state.hangNext = 1;
    // A job with a short retry delay, so pg-boss retries it within the test.
    await h.boss.send(LARK, JOB, { retryLimit: 3, retryDelay: 1 });
    const outcomes: string[] = [];
    const worker = await h.boss.work<LarkJob>(LARK, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      outcomes.push(await larkSend(h, job!, deps, job!.signal));
    });
    try {
      await expect.poll(() => outcomes, { timeout: 15_000 }).toEqual(['posted']);
    } finally {
      await h.boss.offWork(LARK, { id: worker });
    }
    const calls = lark.messageCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.uuid).toBe(larkUuid('brf_g', 'oc_shared'));
    expect(calls[1]!.body.uuid).toBe(calls[0]!.body.uuid);
    expect(String(calls[0]!.body.uuid)).toHaveLength(32);
    expect(await messageIds()).toEqual([{ message_id: 'om_1' }]);
  });

  it('a restart while lark.send is active gives exactly one post and one message id', async () => {
    // Lark accepts the post, but the worker dies before it reads the answer.
    lark.state.hangNext = 1;
    lark.state.hangAccepts = true;
    const id = (await sendLarkJob(h.boss, bossDb(), JOB))!;
    const [job] = await h.boss.fetch<LarkJob>(LARK);
    const died = new AbortController();
    const first = larkSend(h, { data: job!.data, retryCount: 0 }, deps, died.signal);
    await expect.poll(() => lark.messages.length).toBe(1);
    died.abort(new Error('worker died'));
    await expect(first).rejects.toThrow();
    expect(await recoverAtStartup(h)).toMatchObject({ larkFailed: 1 });
    expect(await jobState(bossDb(), LARK, id)).toMatchObject({ state: 'retry' });
    await h.db.execute(sql`update pgboss.job set start_after = now() where id = ${id}`);
    const [again] = await h.boss.fetch<LarkJob>(LARK);
    expect(again?.id).toBe(id);
    expect(await larkSend(h, { data: again!.data, retryCount: 1 }, deps, signal())).toBe('posted');
    expect(lark.messageCalls()).toHaveLength(2);
    expect(lark.messages).toHaveLength(1);
    expect(await messageIds()).toEqual([{ message_id: 'om_1' }]);
    // A further run posts nothing.
    expect(await larkSend(h, { data: JOB, retryCount: 2 }, deps, signal())).toBe('already_posted');
    expect(lark.messageCalls()).toHaveLength(2);
  });

  it('a lark_messages row older than 1 hour without a message id posts nothing and writes lark_send_failed', async () => {
    await h.db.execute(sql`insert into lark_messages (id, briefing_id, chat, uuid, created_at) values ('lark_1', 'brf_g', 'oc_shared', ${larkUuid('brf_g', 'oc_shared')}, ${new Date(h.clock.t - HOUR - MIN)})`);
    expect(await larkSend(h, { data: JOB, retryCount: 1 }, deps, signal())).toBe('gave_up');
    expect(lark.requests).toEqual([]);
    expect(await all(h, sql`select kind, briefing_id from alerts`)).toEqual([{ kind: 'lark_send_failed', briefing_id: 'brf_g' }]);
  });

  it('a row just under 1 hour old but within two post timeouts of it posts nothing and writes lark_send_failed', async () => {
    // Default larkSendTimeoutSeconds is 30: the margin is 60 s, so 59 min 30 s is already too late to post.
    await h.db.execute(sql`insert into lark_messages (id, briefing_id, chat, uuid, created_at) values ('lark_1', 'brf_g', 'oc_shared', ${larkUuid('brf_g', 'oc_shared')}, ${new Date(h.clock.t - HOUR + 30_000)})`);
    expect(await larkSend(h, { data: JOB, retryCount: 1 }, deps, signal())).toBe('gave_up');
    expect(lark.requests).toEqual([]);
    expect(await all(h, sql`select kind, briefing_id from alerts`)).toEqual([{ kind: 'lark_send_failed', briefing_id: 'brf_g' }]);
  });

  it('a post that still fails on the last retry writes lark_send_failed', async () => {
    lark.state.failNext = 10;
    await expect(larkSend(h, { data: JOB, retryCount: 0 }, deps, signal())).rejects.toThrow('HTTP 500');
    expect(await all(h, sql`select kind from alerts`)).toEqual([]);
    await expect(larkSend(h, { data: JOB, retryCount: 3 }, deps, signal())).rejects.toThrow('HTTP 500');
    expect(await all(h, sql`select kind from alerts`)).toEqual([{ kind: 'lark_send_failed' }]);
  });

  it('a run with two network cool-downs has two network_error Alerts, each sent with its own Lark message id; seeded blocked and parse_error Alerts are each sent too', async () => {
    await setSettings(h, { countries: ['US', 'GB'] });
    const runId = await insertRun(h, { scheduledFor: h.clock.now(), deadline: new Date(h.clock.t + 4 * HOUR) });
    expect(await runCrawl(h, runId, runDeps(h, fakeSite(() => ({ kind: 'timeout' }))))).toBe('done');
    expect(await one(h, sql`select network_cooldowns from crawl_runs where id = ${runId}`)).toEqual({ network_cooldowns: 2 });
    for (const kind of ['blocked', 'parse_error']) {
      const r = await insertRun(h, { trigger: 'cli', deadline: h.clock.now(), status: 'done', pairs: [] });
      await h.db.execute(sql`insert into alerts (id, kind, run_id, created_at) values (${`alert_${kind}`}, ${kind}, ${r}, ${h.clock.now()})`);
    }
    await h.db.execute(sql`update crawler_state set heartbeat_at = ${h.clock.now()}`);
    await h.db.execute(sql`update run_time_changes set effective_from = ${h.clock.now()}`);
    const r = await watchdogPass(h, { restartWorker: async () => {}, sendAlert: alertSender(deps.lark, 'oc_admin', 30) });
    expect(r).toMatchObject({ alertsSent: 4, alertsLeft: 0 });
    const sent = await all<{ id: string; kind: string; lark_message_id: string }>(h, sql`select id, kind, lark_message_id from alerts order by kind, cooldown_seq`);
    expect(sent.map((a) => a.kind)).toEqual(['blocked', 'network_error', 'network_error', 'parse_error']);
    expect(new Set(sent.map((a) => a.lark_message_id)).size).toBe(4);
    expect(lark.messages.every((m) => m.chat === 'oc_admin')).toBe(true);
    expect(lark.messages.map((m) => m.uuid).sort()).toEqual(sent.map((a) => larkUuid(a.id)).sort());
    expect(lark.messages.find((m) => m.uuid === larkUuid('alert_blocked'))!.text).toContain('[Ideas Hub] Cảnh báo: Bị chặn');
  });

  describe('watchdog briefing checks', () => {
    const pass = (sharedChat: string | null = 'oc_shared') => watchdogPass(h, { restartWorker: async () => {}, briefings: { sharedChat } });
    beforeEach(() => h.db.execute(sql`update crawler_state set heartbeat_at = ${h.clock.now()}`));
    const kinds = async () => (await all<{ kind: string }>(h, sql`select kind from alerts where briefing_id is not null order by kind`)).map((a) => a.kind);

    it('writes briefing_late when the global briefing has no ready_at by the ready time, once', async () => {
      await h.db.execute(sql`update briefings set ready_at = null`);
      h.clock.t = vietnamInstant('2026-10-21', '06:59').getTime();
      await pass();
      expect(await kinds()).toEqual([]);
      h.clock.t = vietnamInstant('2026-10-21', '07:00').getTime();
      await pass();
      await pass();
      expect(await kinds()).toEqual(['briefing_late']);
    });

    it('creates the global row it points at when no build started', async () => {
      await h.db.execute(sql`truncate briefings cascade`);
      await pass();
      expect(await all(h, sql`select a.kind, b.scope from alerts a join briefings b on b.id = a.briefing_id`)).toEqual([{ kind: 'briefing_late', scope: 'global' }]);
    });

    it('writes lark_send_failed when the ready global briefing has no message id for the shared group; nothing once it has', async () => {
      await pass();
      expect(await kinds()).toEqual(['lark_send_failed']);
      await h.db.execute(sql`truncate alerts`);
      await h.db.execute(sql`insert into lark_messages (id, briefing_id, chat, uuid, message_id) values ('lark_1', 'brf_g', 'oc_shared', 'u1', 'om_9')`);
      await pass();
      expect(await kinds()).toEqual([]);
    });
  });
});
