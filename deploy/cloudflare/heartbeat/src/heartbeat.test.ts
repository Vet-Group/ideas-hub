import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { type Env, INITIAL_STATE, larkSign, noticeText, postLark, probe, type State, step, tick } from './heartbeat';

const t0 = new Date('2026-10-23T10:00:00Z');
const fail = { ok: false, reason: 'HTTP 502' } as const;

describe('step', () => {
  it('stays quiet on a healthy probe', () => {
    expect(step(INITIAL_STATE, { ok: true }, t0)).toEqual({ next: INITIAL_STATE, notice: null });
  });

  it('counts one failure without a notice', () => {
    const { next, notice } = step(INITIAL_STATE, fail, t0);
    expect(notice).toBeNull();
    expect(next).toEqual({ status: 'up', failures: 1, failingSince: t0.toISOString() });
  });

  it('goes down on the second failure in a row, once', () => {
    const one = step(INITIAL_STATE, fail, t0).next;
    const two = step(one, fail, new Date(t0.getTime() + 300_000));
    expect(two.notice).toEqual({ kind: 'down', reason: 'HTTP 502', since: t0.toISOString() });
    expect(two.next.status).toBe('down');
    const three = step(two.next, fail, new Date(t0.getTime() + 600_000));
    expect(three.notice).toBeNull();
    expect(three.next.status).toBe('down');
  });

  it('forgets a single blip', () => {
    const one = step(INITIAL_STATE, fail, t0).next;
    expect(step(one, { ok: true }, t0)).toEqual({ next: INITIAL_STATE, notice: null });
  });

  it('recovers with one notice that carries the start of the outage', () => {
    const down: State = { status: 'down', failures: 5, failingSince: t0.toISOString() };
    const { next, notice } = step(down, { ok: true }, new Date(t0.getTime() + 900_000));
    expect(notice).toEqual({ kind: 'up', since: t0.toISOString() });
    expect(next).toEqual(INITIAL_STATE);
  });
});

describe('larkSign', () => {
  it('matches the HMAC the app computes for the same webhook', async () => {
    const expected = createHmac('sha256', '1761213600\nsecret').update('').digest('base64');
    expect(await larkSign('1761213600', 'secret')).toBe(expected);
  });
});

describe('noticeText', () => {
  it('reports the outage length on recovery', () => {
    const text = noticeText({ kind: 'up', since: t0.toISOString() }, 'https://x/api/health', new Date(t0.getTime() + 900_000));
    expect(text).toContain('15 phút');
  });
});

describe('probe', () => {
  it('is healthy only on 200', async () => {
    expect(await probe('https://x', async () => new Response('{}', { status: 200 }))).toEqual({ ok: true });
    expect(await probe('https://x', async () => new Response('', { status: 503 }))).toEqual({ ok: false, reason: 'HTTP 503' });
    expect(await probe('https://x', async () => new Response('', { status: 302 }))).toEqual({ ok: false, reason: 'HTTP 302' });
  });

  it('treats a network error as a failure', async () => {
    expect(await probe('https://x', async () => Promise.reject(new TypeError('fetch failed')))).toEqual({ ok: false, reason: 'connection failed' });
  });
});

describe('postLark', () => {
  it('posts the custom-bot payload, signed when a secret is set', async () => {
    const fetchFn = vi.fn(async (_u: unknown, _i?: RequestInit) => Response.json({ code: 0 }));
    await postLark('https://lark/hook', 'secret', 'hello', new Date(1761213600_000), fetchFn as unknown as typeof fetch);
    const body = JSON.parse(String(fetchFn.mock.calls[0]![1]!.body));
    expect(body).toEqual({ timestamp: '1761213600', sign: await larkSign('1761213600', 'secret'), msg_type: 'text', content: { text: 'hello' } });
  });

  it('omits the signature without a secret and hides the URL in errors', async () => {
    const fetchFn = vi.fn(async (_u: unknown, _i?: RequestInit) => Response.json({ code: 19001, msg: 'bad' }, { status: 200 }));
    await expect(postLark('https://lark/hook/token', undefined, 'x', t0, fetchFn as unknown as typeof fetch)).rejects.toThrow(/code 19001, bad$/);
    expect(JSON.parse(String(fetchFn.mock.calls[0]![1]!.body))).toEqual({ msg_type: 'text', content: { text: 'x' } });
  });
});

describe('tick', () => {
  const setup = (health: number, larkCode = 0) => {
    const store = new Map<string, string>();
    const posts: string[] = [];
    const env: Env = {
      HEARTBEAT: { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) },
      LARK_WEBHOOK_URL: 'https://lark/hook',
      HEALTH_URL: 'https://x/api/health',
    };
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url === 'https://lark/hook') {
        posts.push(JSON.parse(String(init?.body)).content.text);
        return Response.json({ code: larkCode });
      }
      return new Response('', { status: health });
    }) as unknown as typeof fetch;
    return { env, store, posts, fetchFn };
  };

  it('posts once when the host goes down and once when it returns', async () => {
    const s = setup(503);
    for (let i = 0; i < 4; i++) await tick(s.env, new Date(t0.getTime() + i * 300_000), s.fetchFn);
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0]).toContain('không phản hồi');
    const up = setup(200);
    up.store.set('state', s.store.get('state')!);
    await tick(up.env, new Date(t0.getTime() + 1_500_000), up.fetchFn);
    await tick(up.env, new Date(t0.getTime() + 1_800_000), up.fetchFn);
    expect(up.posts).toHaveLength(1);
    expect(up.posts[0]).toContain('phục hồi');
  });

  it('writes nothing while healthy', async () => {
    const s = setup(200);
    await tick(s.env, t0, s.fetchFn);
    expect(s.store.size).toBe(0);
  });

  it('retries the down notice on the next tick when Lark rejects it', async () => {
    const s = setup(503, 19001);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await tick(s.env, t0, s.fetchFn);
    await tick(s.env, new Date(t0.getTime() + 300_000), s.fetchFn);
    await tick(s.env, new Date(t0.getTime() + 600_000), s.fetchFn);
    expect(s.posts).toHaveLength(2);
    expect(JSON.parse(s.store.get('state')!).status).toBe('up');
  });
});
