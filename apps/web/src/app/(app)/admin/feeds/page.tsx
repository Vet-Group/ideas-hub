import { newsFeeds } from '@ideas-hub/db';
import { asc } from 'drizzle-orm';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { addFeed, setFeedEnabled } from './actions';

const s = t.admin.feeds;

export default async function FeedsPage() {
  await requireAdmin();
  const rows = await db.select().from(newsFeeds).orderBy(asc(newsFeeds.createdAt));
  return (
    <>
      <PageHeader title={s.title} />
      <form action={addFeed} className="bg-surface border-line rounded-card mb-4 flex flex-wrap items-end gap-3 border p-3">
        <div className="grid min-w-72 flex-1 gap-1.5">
          <Label htmlFor="url">{s.url}</Label>
          <Input id="url" name="url" type="url" required />
        </div>
        <Button type="submit">{s.create}</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-fg-2">{s.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{s.url}</TableHead>
              <TableHead>{s.active}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="max-w-[520px] truncate font-mono">{f.url}</TableCell>
                <TableCell>{f.enabled ? t.common.yes : t.common.no}</TableCell>
                <TableCell className="text-right">
                  <form action={setFeedEnabled}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="enabled" value={f.enabled ? '0' : '1'} />
                    <Button type="submit" size="sm" variant="outline">
                      {f.enabled ? s.pause : s.resume}
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
