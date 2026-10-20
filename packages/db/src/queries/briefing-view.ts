// Reads of built briefings for the briefing page and keyword reports (spec §3, §4; plan Step 7). Sections
// 1–4 are shared research data; the AI sections (5 and 6) of a keyword briefing go only to admins and to
// members of a store that tracks the keyword (canSeeKeywordAi), everyone for a seed keyword.
import { type BriefingSections, type Viewer, canSeeKeywordAi } from '@ideas-hub/core';
import { and, asc, desc, eq, isNotNull, lte } from 'drizzle-orm';
import { type Db } from '../client';
import { briefings, keywords, storeKeywords, suggestions } from '../schema';

export interface BriefingRow {
  id: string;
  date: string;
  scope: 'global' | 'keyword';
  keywordId: string | null;
  sections: BriefingSections;
  llmCalls: number;
  aiCostUsd: string;
  readyAt: Date | null;
}

export interface SuggestionRow {
  id: string;
  kind: 'idea' | 'keyword';
  text: string;
  reason: string;
  evidence: { ads: string[]; news: string[] };
}

const columns = {
  id: briefings.id,
  date: briefings.date,
  scope: briefings.scope,
  keywordId: briefings.keywordId,
  sections: briefings.sections,
  llmCalls: briefings.llmCalls,
  aiCostUsd: briefings.aiCostUsd,
  readyAt: briefings.readyAt,
};

const asRow = (r: { sections: unknown } & Omit<BriefingRow, 'sections'>): BriefingRow => ({ ...r, sections: r.sections as BriefingSections });

/** The global briefing of an Asia/Ho_Chi_Minh date, ready or not; null when none was started. */
export async function globalBriefing(db: Db, date: string): Promise<BriefingRow | null> {
  const [r] = await db.select(columns).from(briefings).where(and(eq(briefings.date, date), eq(briefings.scope, 'global'))).limit(1);
  return r ? asRow(r) : null;
}

/** The latest global briefing with `ready_at` on or before `onOrBefore` (a date), for "Đang hiển thị briefing ngày …". */
export async function latestReadyBriefing(db: Db, onOrBefore: string): Promise<BriefingRow | null> {
  const [r] = await db
    .select(columns)
    .from(briefings)
    .where(and(eq(briefings.scope, 'global'), isNotNull(briefings.readyAt), lte(briefings.date, onOrBefore)))
    .orderBy(desc(briefings.date))
    .limit(1);
  return r ? asRow(r) : null;
}

/** Section 6's rows, in the order the model gave them. */
export async function briefingSuggestions(db: Db, briefingId: string): Promise<SuggestionRow[]> {
  return db
    .select({ id: suggestions.id, kind: suggestions.kind, text: suggestions.text, reason: suggestions.reason, evidence: suggestions.evidence })
    .from(suggestions)
    .where(eq(suggestions.briefingId, briefingId))
    .orderBy(asc(suggestions.createdAt), asc(suggestions.id));
}

export interface KeywordBriefing {
  briefing: BriefingRow;
  /** Without `news` and `suggestions` when `aiVisible` is false. */
  sections: BriefingSections;
  /** Empty when `aiVisible` is false. */
  suggestions: SuggestionRow[];
  aiVisible: boolean;
}

/** A keyword briefing for one viewer (AC 4): its AI sections only when the viewer may see them. */
export async function keywordBriefingFor(db: Db, viewer: Viewer, keywordId: string, date: string): Promise<KeywordBriefing | null> {
  const [r] = await db
    .select(columns)
    .from(briefings)
    .where(and(eq(briefings.date, date), eq(briefings.scope, 'keyword'), eq(briefings.keywordId, keywordId)))
    .limit(1);
  if (!r) return null;
  const [kw] = await db.select({ origin: keywords.origin }).from(keywords).where(eq(keywords.id, keywordId));
  const trackedBy = (await db.select({ storeId: storeKeywords.storeId }).from(storeKeywords).where(eq(storeKeywords.keywordId, keywordId))).map((t) => t.storeId);
  const briefing = asRow(r);
  const aiVisible = !!kw && canSeeKeywordAi(viewer, { origin: kw.origin, trackedBy });
  if (!aiVisible) {
    const { news: _news, suggestions: _suggestions, ...shared } = briefing.sections;
    return { briefing: { ...briefing, sections: shared }, sections: shared, suggestions: [], aiVisible };
  }
  return { briefing, sections: briefing.sections, suggestions: await briefingSuggestions(db, briefing.id), aiVisible };
}

