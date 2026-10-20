// Run-time check of saveAction's input: a server action is a public endpoint, so its arguments are untrusted.
import { z } from 'zod';

const id = z.string().min(1).max(100);

const saveSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ad'), adArchiveId: id, via: z.enum(['ads', 'briefing']), keyword: z.string().max(200).optional() }),
  z.object({ kind: z.literal('suggestion'), suggestionId: id }),
]);

/** What is saved; the server builds the title and snapshot from its own data, never from the client. */
export type SaveSource = z.infer<typeof saveSource>;

export const saveInput = z.object({ source: saveSource, storeIds: z.array(id).max(50) });

/** The keyword shown on a saved ad: the client's choice only when the ad was seen for it, else the ad's first keyword. */
export function snapshotKeyword(adKeywords: readonly { text: string }[], keyword: string | undefined): string | null {
  return adKeywords.find((k) => k.text === keyword)?.text ?? adKeywords[0]?.text ?? null;
}
