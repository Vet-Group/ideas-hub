// Lark delivery (spec §3 "Delivery"; plan Step 3 `lark.send`, Step 7 "Lark"): the Ideas Hub bot posts each
// briefing's summary to its chat and the watchdog's Alerts to admin. Every post carries Lark's `uuid`
// dedupe field (first 32 hex characters of a SHA-256), and a briefing post's `lark_messages` row is
// inserted before the call, so a retry never posts twice.
import { createHash } from 'node:crypto';
import { type BriefingSections, type Delta } from '@ideas-hub/core';
import { larkMessages } from '@ideas-hub/db';
import { and, eq, sql } from 'drizzle-orm';
import { bounded } from './bounded';
import { type Ctx, loadSettings } from './context';
import { LARK_RETRY_LIMIT, type LarkJob } from './queues';
import { insertAlert } from './runs';
import { type AlertRow } from './watchdog-pass';

const HOUR = 3_600_000;

export const larkUuid = (...parts: string[]) => createHash('sha256').update(parts.join('')).digest('hex').slice(0, 32);

export interface LarkClient {
  /** Posts a text message to a chat; returns Lark's message id. */
  post(chat: string, uuid: string, text: string, signal: AbortSignal): Promise<string>;
}

export interface LarkConfig {
  baseUrl: string;
  appId: string;
  appSecret: string;
  /** The shared group that gets the global briefing. */
  sharedChat: string | null;
  /** Where the watchdog sends Alerts. */
  adminChat: string | null;
}

/** Null until the bot app's id and secret are set. */
export function larkConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LarkConfig | null {
  if (!env.LARK_APP_ID || !env.LARK_APP_SECRET) return null;
  return {
    baseUrl: (env.LARK_BASE_URL || 'https://open.larksuite.com').replace(/\/+$/, ''),
    appId: env.LARK_APP_ID,
    appSecret: env.LARK_APP_SECRET,
    sharedChat: env.LARK_SHARED_CHAT_ID || null,
    adminChat: env.LARK_ADMIN_CHAT_ID || null,
  };
}

/** Lark Open API: tenant_access_token (cached until a minute before it expires) and im/v1/messages. */
export function larkHttpClient(cfg: Pick<LarkConfig, 'baseUrl' | 'appId' | 'appSecret'>, fetchFn: typeof fetch = fetch): LarkClient {
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
 * nothing; one older than Lark's 1 h uuid window without a message id posts nothing and writes
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
  if (now.getTime() - row.createdAt.getTime() > HOUR) {
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
