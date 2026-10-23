import { can } from '@ideas-hub/core';
import { listStoreKeywords } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { userStores } from '@/lib/store';
import { t } from '@/lib/strings.vi';
import { addTrackedKeyword, removeTrackedKeyword } from './actions';

const s = t.storeKeywords;

/** The tracked keywords of the store chosen in the switcher, for users with its `keywords` tick (spec §4). */
export default async function StoreKeywordsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { selectedId, stores } = await userStores(user);
  if (!selectedId || !can(user, selectedId, 'keywords')) notFound();
  const rows = (await listStoreKeywords(db, user, selectedId)) ?? [];
  const { error } = await searchParams;
  const message = error ? s.errors[error] : undefined;
  return (
    <>
      <PageHeader title={s.title(stores.find((x) => x.id === selectedId)?.name ?? '')} />
      <form action={addTrackedKeyword} className="bg-surface border-line rounded-card mb-4 flex flex-wrap items-end gap-3 border p-3">
        <input type="hidden" name="storeId" value={selectedId} />
        <div className="grid min-w-60 flex-1 gap-1.5">
          <Label htmlFor="text">{s.text}</Label>
          <Input id="text" name="text" required maxLength={100} aria-invalid={message ? true : undefined} aria-describedby={message ? 'kw-error' : undefined} />
        </div>
        <Button type="submit">{s.add}</Button>
        {message ? (
          <p id="kw-error" role="alert" className="text-critical w-full text-[13px]">
            {message}
          </p>
        ) : null}
      </form>
      {rows.length === 0 ? (
        <p className="text-fg-2">{s.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{s.text}</TableHead>
              <TableHead>{s.origin}</TableHead>
              <TableHead>{s.status}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((k) => (
              <TableRow key={k.id}>
                <TableCell>
                  <Link href={`/keywords/${k.id}`} className="font-medium underline-offset-2 hover:underline">
                    {k.text}
                  </Link>
                </TableCell>
                <TableCell>{t.keywords.origins[k.origin] ?? k.origin}</TableCell>
                <TableCell>{k.active ? t.common.yes : t.keywords.paused}</TableCell>
                <TableCell className="text-right">
                  <form action={removeTrackedKeyword}>
                    <input type="hidden" name="storeId" value={selectedId} />
                    <input type="hidden" name="keywordId" value={k.id} />
                    <Button type="submit" size="sm" variant="outline" aria-label={s.removeLabel(k.text)}>
                      {s.remove}
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
