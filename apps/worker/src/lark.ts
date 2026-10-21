// Lark delivery (spec §3 "Delivery"; plan Step 3 `lark.send`, Step 7 "Lark"): the Ideas Hub bot posts each
// briefing's summary to its chat and the watchdog's Alerts to admin. Every post carries Lark's `uuid`
// dedupe field (first 32 hex characters of a SHA-256), and a briefing post's `lark_messages` row is
// inserted before the call, so a retry never posts twice.
import { createHash, createHmac } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { type BriefingSections, type Delta, LARK_RETRY_LIMIT } from '@ideas-hub/core';
import { larkMessages } from '@ideas-hub/db';
import { and, eq, sql } from 'drizzle-orm';
import { bounded } from './bounded';
import { type Ctx, loadSettings } from './context';
import { type LarkJob } from './queues';
import { insertAlert } from './runs';
import { type AlertRow } from './watchdog-pass';

const HOUR = 3_600_000;

export const larkUuid = (...parts: string[]) => createHash('sha256').update(parts.join('')).digest('hex').slice(0, 32);

export interface LarkClient {
  /** Posts a text message to a chat; returns Lark's message id. */
  post(chat: string, uuid: string, text: string, signal: AbortSignal): Promise<string>;
}

/**
 * The chat a webhook post is recorded under: a custom bot posts only to its own group, so the shared group
 * and the admin chat are both this label in `lark_messages` and the watchdog checks.
 */
export const WEBHOOK_CHAT = 'webhook';

export type LarkConfig =
  | {
      mode: 'app';
      baseUrl: string;
      appId: string;
      appSecret: string;
      /** The shared group that gets the global briefing. */
      sharedChat: string | null;
      /** Where the watchdog sends Alerts. */
      adminChat: string | null;
    }
  | { mode: 'webhook'; webhookUrl: string; webhookSecret: string | null; sharedChat: string; adminChat: string };

/** The bot app when its id and secret are set, else a custom-bot webhook when its URL is set, else null. */
export function larkConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LarkConfig | null {
  if (env.LARK_APP_ID && env.LARK_APP_SECRET) {
    return {
      mode: 'app',
      baseUrl: (env.LARK_BASE_URL || 'https://open.larksuite.com').replace(/\/+$/, ''),
      appId: env.LARK_APP_ID,
      appSecret: env.LARK_APP_SECRET,
      sharedChat: env.LARK_SHARED_CHAT_ID || null,
      adminChat: env.LARK_ADMIN_CHAT_ID || null,
    };
  }
  if (env.LARK_WEBHOOK_URL) {
    return { mode: 'webhook', webhookUrl: env.LARK_WEBHOOK_URL, webhookSecret: env.LARK_WEBHOOK_SECRET || null, sharedChat: WEBHOOK_CHAT, adminChat: WEBHOOK_CHAT };
  }
  return null;
}

export const larkClientFor = (cfg: LarkConfig): LarkClient => (cfg.mode === 'app' ? larkHttpClient(cfg) : larkWebhookClient(cfg));

/** Lark Open API: tenant_access_token (cached until a minute before it expires) and im/v1/messages. */
export function larkHttpClient(cfg: Pick<Extract<LarkConfig, { mode: 'app' }>, 'baseUrl' | 'appId' | 'appSecret'>, fetchFn: typeof fetch = fetch): LarkClient {
  let token: { value: string; until: number } | null = null;
  const call = async (path: string, body: unknown, signal: AbortSignal, auth?: string) => {
    const res = await fetchFn(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    const json = (await res.json().catch(() => ({}))) as { code?: number; msg?: string } & Record<string, unknown>;
    if (!res.ok || json.code !== 0) throw new Error(`Lark ${path} failed: HTTP ${res.status}, code ${json.code}, ${json.msg ?? ''}`.trim());
    return json;
  };
  return {
    async post(chat, uuid, text, signal) {
      if (!token || Date.now() >= token.until) {
        const t = await call('/open-apis/auth/v3/tenant_access_token/internal', { app_id: cfg.appId, app_secret: cfg.appSecret }, signal);
        token = { value: String(t.tenant_access_token), until: Date.now() + (Number(t.expire) - 60) * 1000 };
      }
      try {
        const r = await call('/open-apis/im/v1/messages?receive_id_type=chat_id', { receive_id: chat, msg_type: 'text', content: JSON.stringify({ text }), uuid }, signal, token.value);
        return String((r.data as { message_id: string }).message_id);
      } catch (e) {
        token = null; // a rejected token is fetched again on the next post
        throw e;
      }
    },
  };
}

/** Custom-bot limits: 5 posts a second and 100 a minute per bot. */
const WEBHOOK_PER_SECOND = 5;
const WEBHOOK_PER_MINUTE = 100;

/** Milliseconds to wait before one more webhook post, given the send times (oldest first) of the last minute. */
export function webhookWait(sent: readonly number[], now: number): number {
  const minute = sent.filter((t) => t > now - 60_000);
  const second = minute.filter((t) => t > now - 1000);
  return Math.max(
    0,
    minute.length >= WEBHOOK_PER_MINUTE ? minute[minute.length - WEBHOOK_PER_MINUTE]! + 60_000 - now : 0,
    second.length >= WEBHOOK_PER_SECOND ? second[second.length - WEBHOOK_PER_SECOND]! + 1000 - now : 0,
  );
}

/**
 * A Lark custom bot (a group's webhook): a text message with Lark's `timestamp` and `sign` when a secret is
 * set. Lark returns no message id and does not dedupe, so the id is `webhook:<uuid>`, which keeps the
 * `lark_messages` row written before the post and the AC 1 and AC 3 checks working.
 * shortcut: the rate limit is per process (worker and watchdog each count their own posts), enough for a
 * few posts a day; a shared counter is needed only if posts come near 5 a second.
 */
export function larkWebhookClient(cfg: { webhookUrl: string; webhookSecret: string | null }, fetchFn: typeof fetch = fetch): LarkClient {
  const sent: number[] = [];
  return {
    async post(_chat, uuid, text, signal) {
      for (let wait = webhookWait(sent, Date.now()); wait > 0; wait = webhookWait(sent, Date.now())) await sleep(wait, undefined, { signal });
      sent.push(Date.now());
      while (sent.length > WEBHOOK_PER_MINUTE) sent.shift();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signed = cfg.webhookSecret ? { timestamp, sign: createHmac('sha256', `${timestamp}\n${cfg.webhookSecret}`).update('').digest('base64') } : {};
      const res = await fetchFn(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ...signed, msg_type: 'text', content: { text } }),
        signal,
      });
      const json = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
      // The URL carries the bot's token, so it is never part of the error.
      if (!res.ok || json.code !== 0) throw new Error(`Lark webhook failed: HTTP ${res.status}, code ${json.code}, ${json.msg ?? ''}`.trim());
      return `webhook:${uuid}`;
    },
  };
}

/** Bounds one post by the Lark send timeout (settings) and the job's signal. */
export const postSignal = (signal: AbortSignal, timeoutSeconds: number) => AbortSignal.any([signal, AbortSignal.timeout(timeoutSeconds * 1000)]);

// ---- messages (Vietnamese: they are read by staff in Lark) --------------------------------------------

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const change = (d: Delta | null) => (d ? ` (${d.change > 0 ? '+' : ''}${d.change} so với ${ddmm(d.baselineDay)})` : '');

export function briefingMessage(b: { date: string; keywordId: string | null; keywordText: string | null }, s: BriefingSections, appUrl: string): string {
  const points = [
    s.kpi && `Quảng cáo đang chạy: ${s.kpi.runningAds}${change(s.kpi.delta)}`,
    s.hotKeywords?.[0] && `Từ khóa nổi bật: ${s.hotKeywords[0].label}, ${s.hotKeywords[0].runningAds} quảng cáo${change(s.hotKeywords[0].delta)}`,
    s.risingShops?.[0] && `Shop tăng mạnh: ${s.risingShops[0].key}, ${s.risingShops[0].runningAds} quảng cáo${change(s.risingShops[0].delta)}`,
    s.kpi?.nextHoliday && `Ngày lễ sắp tới: ${s.kpi.nextHoliday.name} (còn ${s.kpi.nextHoliday.days} ngày)`,
  ].filter((p): p is string => !!p);
  const top = (s.topAds?.length ? s.topAds : (s.risingAds ?? [])).slice(0, 5);
  const link = b.keywordId ? `${appUrl}/keywords/${b.keywordId}/${b.date}` : `${appUrl}/briefing/${b.date}`;
  return [
    b.keywordText ? `Báo cáo từ khóa "${b.keywordText}" ngày ${ddmm(b.date)}` : `Briefing Ideas Hub ngày ${ddmm(b.date)}`,
    '',
    '3 điểm chính:',
    ...points.slice(0, 3).map((p) => `• ${p}`),
    '',
    'Top 5 quảng cáo:',
    ...(top.length ? top.map((a, i) => `${i + 1}. ${a.pageName ?? a.adArchiveId} · ${a.landingDomain ?? '–'}${a.trendScore === null ? '' : ` · điểm ${a.trendScore}`} https://www.facebook.com/ads/library/?id=${a.adArchiveId}`) : ['(chưa có)']),
    ...(s.news?.state === 'ok' ? ['', `Tóm tắt: ${s.news.summary}`] : []),
    '',
    `Xem chi tiết: ${link}`,
  ].join('\n');
}

const ALERT_LABELS: Record<string, string> = {
  blocked: 'Bị chặn',
  network_error: 'Lỗi mạng, tạm dừng',
  parse_error: 'Lỗi đọc dữ liệu',
  missed_run: 'Lỡ lượt chạy',
  run_failed: 'Lượt chạy lỗi',
  heartbeat_lost: 'Worker mất tín hiệu',
  briefing_late: 'Briefing chưa sẵn sàng đúng giờ',
  lark_send_failed: 'Gửi Lark thất bại',
  settings_invalid: 'Cài đặt không hợp lệ, đã dừng lập lịch',
  deploy_failed: 'Deploy thất bại',
  backup_failed: 'Backup thất bại',
  disk_space: 'Ổ đĩa sắp đầy',
  retention_failed: 'Dọn dữ liệu cũ thất bại',
  acceptance_failed: 'Kiểm tra nghiệm thu hằng ngày không đạt',
};

export function alertMessage(a: AlertRow): string {
  return [
    `[Ideas Hub] Cảnh báo: ${ALERT_LABELS[a.kind] ?? a.kind}`,
    a.run_id && `Run: ${a.run_id}`,
    a.briefing_id && `Briefing: ${a.briefing_id}`,
    a.detail && `Chi tiết: ${a.detail}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The watchdog's Alert sender: one post per Alert, its uuid from the Alert id. */
export function alertSender(lark: LarkClient, chat: string, timeoutSeconds: number) {
  return (a: AlertRow) => lark.post(chat, larkUuid(a.id), alertMessage(a), postSignal(new AbortController().signal, timeoutSeconds));
}

// ---- lark.send ---------------------------------------------------------------------------------------

export interface LarkDeps {
  lark: LarkClient;
  appUrl: string;
}

export type LarkOutcome = 'posted' | 'already_posted' | 'gave_up';

/**
 * Posts one briefing to one chat. The row goes in first; a row that already has a message id posts
 * nothing; one without a message id that is past Lark's 1 h uuid window, less two post timeouts, posts nothing and writes
 * `lark_send_failed`, as does the last retry's failure.
 */
export async function larkSend(ctx: Ctx, job: { data: LarkJob; retryCount: number }, deps: LarkDeps, signal: AbortSignal): Promise<LarkOutcome> {
  const { briefingId, chat } = job.data;
  const s = await bounded(ctx.pool, ({ db }) => loadSettings(db));
  const now = ctx.clock.now();
  const uuid = larkUuid(briefingId, chat);
  const row = await bounded(ctx.pool, async ({ db }) => {
    await db.insert(larkMessages).values({ briefingId, chat, uuid, createdAt: now }).onConflictDoNothing();
    const [r] = await db.select({ messageId: larkMessages.messageId, createdAt: larkMessages.createdAt }).from(larkMessages).where(and(eq(larkMessages.briefingId, briefingId), eq(larkMessages.chat, chat)));
    return r!;
  });
  if (row.messageId) return 'already_posted';
  // Lark dedupes the uuid for 1 h from the first post; two post timeouts of margin keep this post inside it.
  if (now.getTime() - row.createdAt.getTime() > HOUR - 2 * s.larkSendTimeoutSeconds * 1000) {
    await bounded(ctx.pool, ({ db }) => insertAlert(db, { kind: 'lark_send_failed', briefingId, detail: `no message id for chat ${chat} after 1 hour`, at: now }));
    return 'gave_up';
  }
  const { rows } = await bounded(ctx.pool, ({ db }) =>
    db.execute<{ date: string; keyword_id: string | null; text: string | null; sections: BriefingSections }>(sql`
      select b.date::text, b.keyword_id, k.text, b.sections from briefings b left join keywords k on k.id = b.keyword_id where b.id = ${briefingId}`),
  );
  const b = rows[0];
  if (!b) return 'gave_up';
  try {
    const messageId = await deps.lark.post(chat, uuid, briefingMessage({ date: b.date, keywordId: b.keyword_id, keywordText: b.text }, b.sections, deps.appUrl), postSignal(signal, s.larkSendTimeoutSeconds));
    await bounded(ctx.pool, ({ db }) => db.update(larkMessages).set({ messageId }).where(and(eq(larkMessages.briefingId, briefingId), eq(larkMessages.chat, chat))));
    return 'posted';
  } catch (e) {
    if (job.retryCount >= LARK_RETRY_LIMIT) {
      await bounded(ctx.pool, ({ db }) => insertAlert(db, { kind: 'lark_send_failed', briefingId, detail: `chat ${chat}: ${String(e)}`.slice(0, 1000), at: ctx.clock.now() }));
    }
    throw e;
  }
}
