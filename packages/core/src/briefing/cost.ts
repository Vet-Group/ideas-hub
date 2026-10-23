// Pre-call AI cost estimate (spec §3, plan Step 7 "AI"): the prompt at about 3 characters a token plus
// the full `max_completion_tokens` of output, at the model's list price. Checked against the daily cap before every
// call, the retry included; the estimate is what `briefings.ai_cost_usd` records, so it is an upper bound.

export interface ModelPrice {
  /** USD per million tokens. */
  input: number;
  output: number;
}

/**
 * List prices, base input and output, no batch, cache or priority discount. Add a row per model used.
 * Anthropic: checked 2026-10-21 against https://platform.claude.com/docs/en/about-claude/pricing.
 * OpenAI (Standard tier): checked 2026-10-22 against https://developers.openai.com/api/docs/pricing.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'gpt-6.1-sol': { input: 2, output: 10 },
};

/** A model missing from the table is priced high, so the cap still holds. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = { input: 15, output: 75 };

/** Output limit of one briefing call: a summary and up to 10 suggestions fit well inside it. */
export const BRIEFING_MAX_TOKENS = 4000;

/** Vietnamese text and JSON tokenize densely; 3 characters a token over-estimates on purpose. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

/** USD, rounded up to the 4 decimals `ai_cost_usd` stores. */
export function estimateCallUsd(model: string, prompt: { system: string; user: string }, maxTokens = BRIEFING_MAX_TOKENS): number {
  const p = MODEL_PRICES[model] ?? UNKNOWN_MODEL_PRICE;
  const usd = (estimateTokens(prompt.system + prompt.user) * p.input + maxTokens * p.output) / 1_000_000;
  return Math.ceil(usd * 10_000 - 1e-9) / 10_000;
}

/** Whether one more call of `estimate` keeps the day's AI cost, over all briefings of the day, within the cap. */
export function fitsDailyCap(spentToday: number, estimate: number, capUsd: number): boolean {
  return Math.round((spentToday + estimate) * 10_000) <= Math.round(capUsd * 10_000);
}
