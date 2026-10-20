// A fake LLM behind LlmClient and a fake Lark Open API server on a random local port. Tests never reach a
// real LLM or the real Lark.
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type LlmClient, type LlmRequest, cannedReply } from '../src/llm';

/** What the fake model does on its n-th call (1-based). */
export type LlmStep = 'valid' | 'invalid' | 'bad_refs' | 'hang' | 'hang_until_abort' | Error;

export function fakeLlm(script: (n: number) => LlmStep) {
  const calls: LlmRequest[] = [];
  const client: LlmClient = {
    complete(req) {
      calls.push(req);
      const step = script(calls.length);
      if (step instanceof Error) return Promise.reject(step);
      if (step === 'hang') return new Promise(() => {}); // ignores its signal
      if (step === 'hang_until_abort') return new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true }));
      if (step === 'invalid') return Promise.resolve('this is not JSON');
      return Promise.resolve(cannedReply(req.user, 5, step === 'bad_refs' ? 2 : 0));
    },
  };
  return { client, calls };
}

export interface FakeLarkRequest {
  path: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}

/**
 * The two Lark Open API calls the bot uses: tenant_access_token and im/v1/messages. Like Lark, a message
 * with a uuid already seen returns the first message instead of posting again. `failNext` answers the
 * next message calls with an error; `hangNext` never answers them, after accepting the message
 * (`accept`) or not.
 */
export async function fakeLark() {
  const requests: FakeLarkRequest[] = [];
  const messages: { chat: string; text: string; uuid: string; messageId: string }[] = [];
  const state = { failNext: 0, hangNext: 0, hangAccepts: false };
  const hung: ServerResponse[] = [];
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });
  const server: Server = createServer(async (req, res) => {
    const body = JSON.parse((await read(req)) || '{}') as Record<string, unknown>;
    const path = req.url ?? '';
    requests.push({ path, auth: req.headers.authorization, body });
    const json = (status: number, payload: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
    if (path === '/open-apis/auth/v3/tenant_access_token/internal') {
      return body.app_id === 'cli_test' && body.app_secret === 'test-secret'
        ? json(200, { code: 0, msg: 'ok', tenant_access_token: 't-fake', expire: 7200 })
        : json(200, { code: 10014, msg: 'app secret invalid' });
    }
    if (path.startsWith('/open-apis/im/v1/messages')) {
      if (req.headers.authorization !== 'Bearer t-fake') return json(401, { code: 99991663, msg: 'invalid token' });
      const uuid = String(body.uuid ?? '');
      const deliver = () => {
        const seen = messages.find((m) => m.uuid === uuid);
        if (seen) return seen.messageId;
        const messageId = `om_${messages.length + 1}`;
        messages.push({ chat: String(body.receive_id), text: (JSON.parse(String(body.content)) as { text: string }).text, uuid, messageId });
        return messageId;
      };
      if (state.hangNext > 0) {
        state.hangNext -= 1;
        if (state.hangAccepts) deliver();
        hung.push(res);
        return;
      }
      if (state.failNext > 0) {
        state.failNext -= 1;
        return json(500, { code: 230001, msg: 'internal error' });
      }
      return json(200, { code: 0, msg: 'success', data: { message_id: deliver() } });
    }
    json(404, { code: 404, msg: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    config: { baseUrl: url, appId: 'cli_test', appSecret: 'test-secret' },
    requests,
    messages,
    state,
    messageCalls: () => requests.filter((r) => r.path.startsWith('/open-apis/im/v1/messages')),
    reset() {
      requests.length = 0;
      messages.length = 0;
      Object.assign(state, { failNext: 0, hangNext: 0, hangAccepts: false });
    },
    async close() {
      for (const r of hung) r.destroy();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
