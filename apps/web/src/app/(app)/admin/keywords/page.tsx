import { keywords, storeKeywords, stores } from '@ideas-hub/db';
import { asc, eq, sql } from 'drizzle-orm';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { addSeedKeyword, setKeywordActive } from './actions';

const s = t.admin.keywords;

export default async function KeywordsAdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;
  const rows = await db
    .select({
      id: keywords.id,
      text: keywords.text,
      origin: keywords.origin,
      active: keywords.active,
      trackedBy: sql<string[]>`coalesce(array_agg(${stores.name} order by ${stores.name}) filter (where ${stores.id} is not null), '{}')`,
    })
    .from(keywords)
    .leftJoin(storeKeywords, eq(storeKeywords.keywordId, keywords.id))
    .leftJoin(stores, eq(stores.id, storeKeywords.storeId))
    .groupBy(keywords.id)
    .orderBy(asc(keywords.createdAt), asc(keywords.id));
  return (
    <>
      <PageHeader title={s.title} />
      <form action={addSeedKeyword} className="bg-surface border-line rounded-card mb-4 flex flex-wrap items-end gap-3 border p-3">
        <div className="grid min-w-60 flex-1 gap-1.5">
          <Label htmlFor="text">{s.text}</Label>
          <Input id="text" name="text" required aria-invalid={error ? true : undefined} aria-describedby={error ? 'kw-error' : undefined} />
        </div>
        <Button type="submit">{s.create}</Button>
        {error ? (
          <p id="kw-error" role="alert" className="text-critical w-full text-[13px]">
            {s.duplicate}
          </p>
        ) : null}
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{s.text}</TableHead>
            <TableHead>{s.origin}</TableHead>
            <TableHead>{s.trackedBy}</TableHead>
            <TableHead>{s.active}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((k) => (
            <TableRow key={k.id}>
              <TableCell>{k.text}</TableCell>
              <TableCell>{s.origins[k.origin] ?? k.origin}</TableCell>
              <TableCell>{k.trackedBy.length ? k.trackedBy.join(', ') : t.common.none}</TableCell>
              <TableCell>{k.active ? t.common.yes : t.common.no}</TableCell>
              <TableCell className="text-right">
                <form action={setKeywordActive}>
                  <input type="hidden" name="id" value={k.id} />
                  <input type="hidden" name="active" value={k.active ? '0' : '1'} />
                  <Button type="submit" size="sm" variant="outline">
                    {k.active ? s.pause : s.resume}
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
