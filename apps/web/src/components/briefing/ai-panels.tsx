import { type AiMissing, type NewsSection, type SuggestionsSection } from '@ideas-hub/core';
import Link from 'next/link';
import { SaveButton, type SaveTarget } from '@/components/save/save-button';
import { type SuggestionRow } from '@ideas-hub/db/queries';
import { t } from '@/lib/strings.vi';

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

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
 * Section 6: 5–10 ideas and keywords, each with its reason, links to the ads and news behind it, and
 * "Lưu" (a save records `via = briefing`).
 */
export function SuggestionsPanel({
  section,
  rows,
  news,
  adHref,
  stores,
}: {
  section: SuggestionsSection | undefined;
  rows: SuggestionRow[];
  news: NewsSection | undefined;
  adHref: (id: string) => string;
  stores: SaveTarget[];
}) {
  if (!section || section.state !== 'ok') return <AiMissingNote section={section} />;
  if (rows.length === 0) return <p className="text-fg-2 text-sm">{t.briefing.empty}</p>;
  const newsById = new Map((news?.items ?? []).map((n) => [n.id, n]));
  return (
    <ul className="divide-line grid divide-y">
      {rows.map((s) => (
        <li key={s.id} className="grid gap-1 py-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p>
              <span className="bg-neutral-bg text-fg-2 rounded-pill mr-2 px-2 py-0.5 text-xs">{t.briefing.suggestionKind[s.kind]}</span>
              <span className="font-medium">{s.text}</span>
            </p>
            <SaveButton source={{ kind: 'suggestion', suggestionId: s.id }} stores={stores} compact />
          </div>
          <p className="text-fg-2">{s.reason}</p>
          {s.evidence.ads.length || s.evidence.news.length ? (
            <p className="text-fg-2 flex flex-wrap gap-x-2 text-xs">
              <span>{t.briefing.evidence}:</span>
              {s.evidence.ads.map((id, i) => (
                <Link key={id} href={adHref(id)} scroll={false} className="underline underline-offset-2">
                  {t.briefing.evidenceAd(i + 1)}
                </Link>
              ))}
              {s.evidence.news.map((id) => {
                const n = newsById.get(id);
                return n ? (
                  <a key={id} href={n.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {n.title}
                  </a>
                ) : null;
              })}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
