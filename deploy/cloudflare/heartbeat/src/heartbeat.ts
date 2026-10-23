// External heartbeat (phase 3 item 3): a Cloudflare Worker cron probes the app from outside the host and
// posts to Lark only when the state changes. The watchdog runs on the host, so a dead host stays silent
// without this. Plain Web APIs only (no node: imports) so it runs in a Worker and in vitest alike.

/** Failed probes in a row before the host counts as down: one blip (a deploy restart) stays quiet. */
export const FAILURES_TO_DOWN = 2;
export const PROBE_TIMEOUT_MS = 10_000;

export interface State {
  status: 'up' | 'down';
  /** Consecutive failed probes; 0 while up and healthy. */
  failures: number;
  /** ISO time of the first failed probe of the current streak, null when healthy. */
  failingSince: string | null;
}

export const INITIAL_STATE: State = { status: 'up', failures: 0, failingSince: null };

export type Notice = { kind: 'down'; reason: string; since: string } | { kind: 'up'; since: string };

/** One probe result in, the next state and (on a transition) the notice to post out. */
export function step(prev: State, result: { ok: true } | { ok: false; reason: string }, now: Date): { next: State; notice: Notice | null } {
  if (result.ok) {
    const notice: Notice | null = prev.status === 'down' ? { kind: 'up', since: prev.failingSince ?? now.toISOString() } : null;
    return { next: INITIAL_STATE, notice };
  }
  const failures = prev.failures + 1;
  const failingSince = prev.failingSince ?? now.toISOString();
  if (prev.status === 'up' && failures >= FAILURES_TO_DOWN) {
    return { next: { status: 'down', failures, failingSince }, notice: { kind: 'down', reason: result.reason, since: failingSince } };
  }
  return { next: { ...prev, failures, failingSince }, notice: null };
}

/** Healthy means HTTP 200 within the timeout; a redirect is not healthy (the app answers directly). */
export async function probe(url: string, fetchFn: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetchFn(url, { redirect: 'manual', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel();
    return res.status === 200 ? { ok: true } : { ok: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === 'TimeoutError' ? `no answer within ${PROBE_TIMEOUT_MS / 1000}s` : 'connection failed' };
  }
}

/** Lark custom-bot signature: HMAC-SHA256 keyed with `<timestamp>\n<secret>` over an empty message, base64. */
export async function larkSign(timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${timestamp}\n${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new Uint8Array());
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

// Vietnamese: staff read these in Lark.
export function noticeText(n: Notice, url: string, now: Date): string {
  if (n.kind === 'down') {
    return `[Ideas Hub] Cảnh báo: máy chủ không phản hồi. Kiểm tra từ bên ngoài (Cloudflare) thất bại ${FAILURES_TO_DOWN} lần liên tiếp từ ${n.since}: ${n.reason}. Địa chỉ: ${url}`;
  }
  const minutes = Math.max(1, Math.round((now.getTime() - Date.parse(n.since)) / 60_000));
  return `[Ideas Hub] Đã phục hồi: máy chủ phản hồi trở lại, gián đoạn khoảng ${minutes} phút (từ ${n.since}). Địa chỉ: ${url}`;
}

/** Posts a text message to a Lark custom bot; throws on a failure, without the URL (it carries the bot's token). */
export async function postLark(webhookUrl: string, secret: string | undefined, text: string, now: Date, fetchFn: typeof fetch = fetch): Promise<void> {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signed = secret ? { timestamp, sign: await larkSign(timestamp, secret) } : {};
  const res = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ...signed, msg_type: 'text', content: { text } }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
  if (!res.ok || json.code !== 0) throw new Error(`Lark webhook failed: HTTP ${res.status}, code ${json.code}, ${json.msg ?? ''}`.trim());
}

export interface Env {
  HEARTBEAT: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  LARK_WEBHOOK_URL: string;
  LARK_WEBHOOK_SECRET?: string;
  HEALTH_URL: string;
}

const STATE_KEY = 'state';

/** One cron tick: probe, step, post on a transition, save. A failed post keeps the old status, so the next tick retries it. */
export async function tick(env: Env, now: Date, fetchFn: typeof fetch = fetch): Promise<void> {
  const raw = await env.HEARTBEAT.get(STATE_KEY);
  const prev: State = raw ? (JSON.parse(raw) as State) : INITIAL_STATE;
  const { next, notice } = step(prev, await probe(env.HEALTH_URL, fetchFn), now);
  let saved = next;
  if (notice) {
    try {
      await postLark(env.LARK_WEBHOOK_URL, env.LARK_WEBHOOK_SECRET, noticeText(notice, env.HEALTH_URL, now), now, fetchFn);
    } catch (e) {
      console.error(e instanceof Error ? e.message : 'Lark post failed');
      saved = { ...next, status: prev.status, failingSince: prev.failingSince ?? next.failingSince };
    }
  }
  // Writes only on a change: KV allows 1,000 writes a day on the free plan, a steady-state tick needs none.
  if (JSON.stringify(saved) !== JSON.stringify(prev)) await env.HEARTBEAT.put(STATE_KEY, JSON.stringify(saved));
}
