import { type AiMissing, type BriefingAd, type NewsSection, type SuggestionsSection } from '@ideas-hub/core';
import { type SuggestionRow } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { SaveButton, type SaveTarget } from '@/components/save/save-button';
import { ddmm } from '@/lib/format';
import { t } from '@/lib/strings.vi';

/** A skipped or failed AI section (spec §6 "AI section skipped", "AI section failed"). */
export function AiMissingNote({ section }: { section: AiMissing | undefined }) {
  const text = section?.state === 'skipped' ? t.briefing.aiSkipped : t.briefing.aiFailed;
  return <p className="border-line text-fg-2 rounded-card border border-dashed p-3 text-sm">{text}</p>;
}

/** Section 5: the AI summary, the news items behind it and the upcoming holidays. */
export function NewsPanel({ news }: { news: NewsSection | undefined }) {
  if (!news) return <AiMissingNote section={undefined} />;
  return (
    <div className="grid gap-3 text-sm">
      {news.state === 'ok' ? <p className="whitespace-pre-line">{news.summary}</p> : <AiMissingNote section={news} />}
      {news.items.length ? (
        <ul className="grid gap-1.5">
          {news.items.map((n) => (
            <li key={n.id} className="grid">
              <a href={n.link} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                {n.title}
              </a>
              <span className="text-fg-2 text-xs">{[n.feed, n.publishedAt ? ddmm(n.publishedAt) : null].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {news.holidays.length ? (
        <div className="grid gap-1">
          <h3 className="text-fg-2 text-xs font-semibold">{t.briefing.holidays}</h3>
          <ul className="grid gap-1">
            {news.holidays.map((h) => (
              <li key={`${h.date}-${h.name}`} className="flex justify-between gap-2">
                <span>{h.name}</span>
                <span className="text-fg-2 font-mono text-xs">
                  {ddmm(h.date)} · {t.briefing.daysAway(h.days)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The ads and news items behind one suggestion, as links ("Dựa trên: <ad title>, …"). An ad not in
 * `adTitles` (not in the briefing's lists, or the idea page, which has no list) reads "ad 1", "ad 2", ….
 */
export function SuggestionEvidence({
  evidence,
  newsById,
  adHref,
  adTitles,
}: {
  evidence: { ads: string[]; news: string[] };
  newsById: Map<string, { link: string; title: string }>;
  adHref: (id: string) => string;
  adTitles?: Map<string, string>;
}) {
  if (!evidence.ads.length && !evidence.news.length) return null;
  return (
    <p className="text-fg-2 flex flex-wrap gap-x-2 gap-y-3 text-xs">
      <span>{t.briefing.evidence}:</span>
      {evidence.ads.map((id, i) => (
        <Link key={id} href={adHref(id)} scroll={false} className="max-w-64 truncate underline underline-offset-2">
          {adTitles?.get(id) ?? t.briefing.evidenceAd(i + 1)}
        </Link>
      ))}
      {evidence.news.map((id) => {
        const n = newsById.get(id);
        return n ? (
          <a key={id} href={n.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {n.title}
          </a>
        ) : null;
      })}
    </p>
  );
}

/**
 * Section 6: 5–10 ideas and keywords, each with its reason, links to the ads and news behind it, and
 * "Lưu" (a save records `via = briefing`).
 */
export function SuggestionsPanel({
  section,
  rows,
  news,
  ads = [],
  adHref,
  stores,
  saved,
}: {
  section: SuggestionsSection | undefined;
  rows: SuggestionRow[];
  news: NewsSection | undefined;
  /** The briefing's ad lists, whose titles name the evidence links. */
  ads?: BriefingAd[];
  adHref: (id: string) => string;
  stores: SaveTarget[];
  /** Suggestion ids already saved. */
  saved: string[];
}) {
  if (!section || section.state !== 'ok') return <AiMissingNote section={section} />;
  if (rows.length === 0) return <p className="text-fg-2 text-sm">{t.briefing.empty}</p>;
  const newsById = new Map((news?.items ?? []).map((n) => [n.id, n]));
  const adTitles = new Map(ads.map((a) => [a.adArchiveId, a.caption || a.pageName || a.adArchiveId]));
  return (
    // content-start: beside a taller news column (the keyword report) the rows keep their height.
    <ul className="divide-line grid content-start divide-y">
      {rows.map((s) => (
        <li key={s.id} className="grid gap-1 py-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p>
              <span className="bg-neutral-bg text-fg-2 rounded-pill mr-2 px-2 py-0.5 text-xs">{t.briefing.suggestionKind[s.kind]}</span>
              <span className="font-medium">{s.text}</span>
            </p>
            <SaveButton source={{ kind: 'suggestion', suggestionId: s.id }} stores={stores} title={s.text} saved={saved.includes(s.id)} />
          </div>
          <p className="text-fg-2">{s.reason}</p>
          <SuggestionEvidence evidence={s.evidence} newsById={newsById} adHref={adHref} adTitles={adTitles} />
        </li>
      ))}
    </ul>
  );
}
