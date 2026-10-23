import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { llmFromEnv } from '../src/llm';

describe('llmFromEnv', () => {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] }));
    });
  });
  let baseURL = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('sends the budget as max_completion_tokens, which reasoning models accept, and never max_tokens', async () => {
    const llm = llmFromEnv({ LLM_BASE_URL: baseURL, LLM_API_KEY: 'test' });
    const reply = await llm.complete({ model: 'gpt-6-luna', system: 's', user: 'u', maxTokens: 4000, signal: new AbortController().signal });
    expect(reply).toBe('ok');
    expect(bodies[0]).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 4000 });
    expect(bodies[0]).not.toHaveProperty('max_tokens');
  });
});
