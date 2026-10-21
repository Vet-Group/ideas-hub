import { LARK_RETRY_LIMIT } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WEBHOOK_CHAT, alertSender, larkClientFor, larkConfigFromEnv, larkSend, larkUuid, larkWebhookClient, webhookWait } from '../src/lark';
import { type LarkJob } from '../src/queues';
import { fakeLark } from './fakes';
import { type Harness, all, harness } from './helpers';

const HOUR = 3_600_000;
const signal = () => new AbortController().signal;

describe('Lark custom-bot webhook', () => {
  let lark: Awaited<ReturnType<typeof fakeLark>>;
  beforeAll(async () => {
    lark = await fakeLark();
  });
  afterAll(async () => {
    await lark?.close();
  });
  beforeEach(() => lark.reset());

  it('is used only when the bot app is not configured and a webhook URL is set', () => {
    expect(larkConfigFromEnv({ LARK_WEBHOOK_URL: 'http://hook.test/x' })).toEqual({
      mode: 'webhook',
      webhookUrl: 'http://hook.test/x',
      webhookSecret: null,
      sharedChat: WEBHOOK_CHAT,
      adminChat: WEBHOOK_CHAT,
    });
    expect(larkConfigFromEnv({ LARK_WEBHOOK_URL: 'http://hook.test/x', LARK_WEBHOOK_SECRET: 's' })).toMatchObject({ mode: 'webhook', webhookSecret: 's' });
    expect(larkConfigFromEnv({ LARK_APP_ID: 'cli_a', LARK_APP_SECRET: 'b', LARK_WEBHOOK_URL: 'http://hook.test/x' })).toMatchObject({ mode: 'app', appId: 'cli_a' });
    expect(larkConfigFromEnv({ LARK_APP_ID: 'cli_a', LARK_WEBHOOK_URL: '' })).toBeNull();
  });

  it('posts the text message unsigned and returns webhook:<uuid> as the message id', async () => {
    const client = larkClientFor(larkConfigFromEnv({ LARK_WEBHOOK_URL: lark.webhookUrl })!);
    expect(await client.post('oc_ignored', 'u1', 'Xin chào\nDòng 2', signal())).toBe('webhook:u1');
    const [call] = lark.webhookCalls();
    expect(call!.body).toEqual({ msg_type: 'text', content: { text: 'Xin chào\nDòng 2' } });
    expect(lark.messages.map((m) => m.text)).toEqual(['Xin chào\nDòng 2']);
  });

  it('signs with timestamp and sign when a secret is set, and a wrong secret is a failed post without the URL', async () => {
    lark.state.webhookSecret = 'hook-secret';
    expect(await larkWebhookClient({ webhookUrl: lark.webhookUrl, webhookSecret: 'hook-secret' }).post('webhook', 'u2', 'hi', signal())).toBe('webhook:u2');
    const body = lark.webhookCalls()[0]!.body;
    expect(Math.abs(Number(body.timestamp) - Date.now() / 1000)).toBeLessThan(5);
    expect(body.sign).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const wrong = larkWebhookClient({ webhookUrl: lark.webhookUrl, webhookSecret: 'other' }).post('webhook', 'u3', 'hi', signal());
    await expect(wrong).rejects.toThrow('code 19021');
    await expect(wrong).rejects.not.toThrow(lark.webhookUrl);
    expect(lark.messages).toHaveLength(1);
  });

  it('a reply with a code other than 0 is a failed post', async () => {
    lark.state.failNext = 1;
    await expect(larkWebhookClient({ webhookUrl: lark.webhookUrl, webhookSecret: null }).post('webhook', 'u4', 'hi', signal())).rejects.toThrow('code 11232');
    expect(lark.messages).toHaveLength(0);
  });

  it('waits for the 5-a-second and 100-a-minute limits', async () => {
    const now = 1_000_000;
    expect(webhookWait([now - 900, now - 800, now - 700, now - 600], now)).toBe(0);
    expect(webhookWait([now - 900, now - 800, now - 700, now - 600, now - 500], now)).toBe(100);
    const minute = Array.from({ length: 100 }, (_, i) => now - 59_000 + i * 10);
    expect(webhookWait(minute, now)).toBe(1000);
    expect(webhookWait(minute.slice(1), now)).toBe(0);
    const client = larkWebhookClient({ webhookUrl: lark.webhookUrl, webhookSecret: null });
    const start = Date.now();
    for (let i = 0; i < 6; i++) await client.post('webhook', `r${i}`, 'hi', signal());
    expect(Date.now() - start).toBeGreaterThanOrEqual(950);
    expect(lark.messages).toHaveLength(6);
  });
});

describe.skipIf(!testDatabaseAvailable())('Lark custom-bot webhook through lark.send', () => {
  let h: Harness;
  let lark: Awaited<ReturnType<typeof fakeLark>>;
  const JOB: LarkJob = { briefingId: 'brf_w', chat: WEBHOOK_CHAT };

  beforeAll(async () => {
    h = await harness('2026-10-21T00:30:00Z');
    lark = await fakeLark();
  }, 60_000);
  afterAll(async () => {
    await lark?.close();
    await h?.close();
  });
  beforeEach(async () => {
    lark.reset();
    await h.db.execute(sql`truncate briefings, alerts cascade`);
    await h.db.execute(sql`insert into briefings (id, date, scope, sections, ready_at) values ('brf_w', '2026-10-21', 'global', '{}', ${new Date(h.clock.t - HOUR)})`);
  });

  it('stores webhook:<uuid> on the row written before the post, and a second send posts nothing', async () => {
    const deps = { lark: larkWebhookClient({ webhookUrl: lark.webhookUrl, webhookSecret: null }), appUrl: 'http://app.test' };
    expect(await larkSend(h, { data: JOB, retryCount: 0 }, deps, signal())).toBe('posted');
    expect(await larkSend(h, { data: JOB, retryCount: 1 }, deps, signal())).toBe('already_posted');
    expect(await all(h, sql`select chat, message_id from lark_messages`)).toEqual([{ chat: 'webhook', message_id: `webhook:${larkUuid('brf_w', 'webhook')}` }]);
    expect(lark.messages).toHaveLength(1);
    expect(lark.messages[0]!.text).toContain('http://app.test/briefing/2026-10-21');
  });

  it('a rejected post is retried by lark.send and the last retry writes lark_send_failed', async () => {
    const deps = { lark: larkWebhookClient({ webhookUrl: lark.webhookUrl, webhookSecret: null }), appUrl: 'http://app.test' };
    lark.state.failNext = 2;
    await expect(larkSend(h, { data: JOB, retryCount: 0 }, deps, signal())).rejects.toThrow('code 11232');
    expect(await all(h, sql`select kind from alerts`)).toEqual([]);
    await expect(larkSend(h, { data: JOB, retryCount: LARK_RETRY_LIMIT }, deps, signal())).rejects.toThrow('code 11232');
    expect(await all(h, sql`select kind, briefing_id from alerts`)).toEqual([{ kind: 'lark_send_failed', briefing_id: 'brf_w' }]);
    expect(await all(h, sql`select message_id from lark_messages`)).toEqual([{ message_id: null }]);
  });

  it('sends an Alert through the webhook with its own uuid', async () => {
    const send = alertSender(larkWebhookClient({ webhookUrl: lark.webhookUrl, webhookSecret: null }), WEBHOOK_CHAT, 30);
    const id = await send({ id: 'alr_1', kind: 'blocked', run_id: 'run_1', briefing_id: null, detail: 'x' });
    expect(id).toBe(`webhook:${larkUuid('alr_1')}`);
    expect(lark.messages[0]!.text).toContain('[Ideas Hub] Cảnh báo: Bị chặn');
  });
});
