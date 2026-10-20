// The JSON the briefing LLM call returns (spec §3, plan Step 7): section 5's summary and section 6's 5–10
// suggestions. Validated with zod; evidence refs must be ids that were in the call's input.
import { z } from 'zod';

export const suggestionSchema = z
  .object({
    kind: z.enum(['idea', 'keyword']),
    text: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(1000),
    evidence: z.object({ ads: z.array(z.string()).max(10), news: z.array(z.string()).max(10) }),
  })
  .refine((s) => s.evidence.ads.length + s.evidence.news.length > 0, { message: 'a suggestion needs at least one evidence ref' });

export const briefingOutputSchema = z.object({
  summary: z.string().trim().min(1).max(3000),
  suggestions: z.array(suggestionSchema).min(5).max(10),
});

export type BriefingSuggestion = z.infer<typeof suggestionSchema>;
export type BriefingOutput = z.infer<typeof briefingOutputSchema>;

export interface PromptRefs {
  ads: ReadonlySet<string>;
  news: ReadonlySet<string>;
}

export type ParsedOutput =
  | { ok: true; summary: string; suggestions: BriefingSuggestion[]; /** Indexes of suggestions citing an id not in the input. */ badRefs: number[] }
  | { ok: false; problem: string };

/** Parses the model's reply: JSON (a Markdown fence around it is tolerated), the schema, then the refs. */
export function parseBriefingOutput(reply: string, refs: PromptRefs): ParsedOutput {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end < start) return { ok: false, problem: 'no JSON object in the reply' };
  let json: unknown;
  try {
    json = JSON.parse(reply.slice(start, end + 1));
  } catch (e) {
    return { ok: false, problem: `invalid JSON: ${(e as Error).message}` };
  }
  const parsed = briefingOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, problem: z.prettifyError(parsed.error) };
  const badRefs = parsed.data.suggestions.flatMap((s, i) =>
    s.evidence.ads.every((id) => refs.ads.has(id)) && s.evidence.news.every((id) => refs.news.has(id)) ? [] : [i],
  );
  return { ok: true, summary: parsed.data.summary, suggestions: parsed.data.suggestions, badRefs };
}

/** The suggestions whose refs all resolve; used once the retry is spent. */
export const keepResolved = (p: Extract<ParsedOutput, { ok: true }>) => p.suggestions.filter((_, i) => !p.badRefs.includes(i));
