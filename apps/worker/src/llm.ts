// The briefing's LLM endpoint (spec §3): OpenAI-compatible, base URL and key from the environment
// (OmniRoute in development, a real provider in production), the model from settings. Tests inject a fake.
import OpenAI from 'openai';

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Aborted by the call timeout or by the job's own signal. */
  signal: AbortSignal;
}

export interface LlmClient {
  /** Returns the reply text. */
  complete(req: LlmRequest): Promise<string>;
}

export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const baseURL = env.LLM_BASE_URL;
  const apiKey = env.LLM_API_KEY;
  if (!baseURL || !apiKey) {
    return {
      complete: async () => {
        throw new Error('LLM_BASE_URL and LLM_API_KEY are not set');
      },
    };
  }
  // maxRetries 0: each attempt must be counted in briefings.llm_calls, so the client never retries on its own.
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0 });
  return {
    async complete(r) {
      const res = await client.chat.completions.create(
        {
          model: r.model,
          max_tokens: r.maxTokens,
          messages: [
            { role: 'system', content: r.system },
            { role: 'user', content: r.user },
          ],
        },
        { signal: r.signal },
      );
      return res.choices[0]?.message?.content ?? '';
    },
  };
}

/** A reply that cites the first ad and news ids of the prompt (`news_…` are news); `badRefs` cite an id never sent. */
export function cannedReply(user: string, n = 5, badRefs = 0): string {
  const ids = [...user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
  const ads = ids.filter((id) => !id.startsWith('news_'));
  const news = ids.filter((id) => id.startsWith('news_'));
  const suggestions = Array.from({ length: n }, (_, i) => ({
    kind: i % 2 ? 'keyword' : 'idea',
    text: `Gợi ý ${i + 1}`,
    reason: `Lý do ${i + 1}`,
    evidence: i < badRefs ? { ads: ['ad_not_sent'], news: [] } : { ads: ads.slice(0, 1), news: news.slice(0, 1) },
  }));
  return JSON.stringify({ summary: 'Tóm tắt tin tức và ngày lễ.', suggestions });
}

/** Makes no call: for `pnpm briefing:build --fake-llm` and tests. */
export const cannedLlm: LlmClient = { complete: async (r) => cannedReply(r.user) };
