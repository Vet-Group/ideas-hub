import { KEYWORD_SORTS, type KeywordSort, listKeywords } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { SortHead } from '@/components/sort-head';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  await requireUser();
  const p = await searchParams;
  const sort: KeywordSort = KEYWORD_SORTS.includes(p.sort as KeywordSort) ? (p.sort as KeywordSort) : 'running_ads';
  const keywords = await listKeywords(db, sort);
  return (
    <>
      <PageHeader title={t.keywords.title} />
      {keywords.length === 0 ? (
        <p className="text-fg-2">{t.keywords.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label={t.keywords.keyword} sort="text" current={sort} base="/keywords" />
              <SortHead label={t.keywords.origin} sort="origin" current={sort} base="/keywords" />
              <SortHead label={t.keywords.runningAds} sort="running_ads" current={sort} base="/keywords" className="text-right" />
              <TableHead>{t.keywords.active}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keywords.map((k) => (
              <TableRow key={k.id}>
                <TableCell>
                  <Link href={`/keywords/${k.id}`} className="font-medium underline-offset-2 hover:underline">
                    {k.text}
                  </Link>
                </TableCell>
                <TableCell>{t.keywords.origins[k.origin] ?? k.origin}</TableCell>
                <TableCell className="text-right font-mono">{k.runningAds ?? t.common.none}</TableCell>
                <TableCell>{k.active ? t.common.yes : t.keywords.paused}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
