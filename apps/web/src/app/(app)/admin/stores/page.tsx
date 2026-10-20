import { storeMembers, stores } from '@ideas-hub/db';
import { asc, count, eq } from 'drizzle-orm';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { createStore } from './actions';

const s = t.admin.stores;

export default async function StoresPage() {
  await requireAdmin();
  const rows = await db
    .select({ id: stores.id, name: stores.name, erp: stores.erpStoreCode, pod: stores.podStudioStoreId, lark: stores.larkChatId, members: count(storeMembers.userId) })
    .from(stores)
    .leftJoin(storeMembers, eq(storeMembers.storeId, stores.id))
    .groupBy(stores.id)
    .orderBy(asc(stores.name));
  return (
    <>
      <PageHeader title={s.title} />
      <form action={createStore} className="bg-surface border-line rounded-card mb-4 flex flex-wrap items-end gap-3 border p-3">
        <div className="grid min-w-60 flex-1 gap-1.5">
          <Label htmlFor="name">{s.name}</Label>
          <Input id="name" name="name" required />
        </div>
        <Button type="submit">{s.create}</Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{s.name}</TableHead>
            <TableHead>{s.erp}</TableHead>
            <TableHead>{s.pod}</TableHead>
            <TableHead>{s.lark}</TableHead>
            <TableHead className="text-right">{s.members}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/admin/stores/${r.id}`} className="text-ink font-medium underline-offset-2 hover:underline">
                  {r.name}
                </Link>
              </TableCell>
              <TableCell className="font-mono">{r.erp ?? t.common.none}</TableCell>
              <TableCell className="font-mono">{r.pod ?? t.common.none}</TableCell>
              <TableCell className="font-mono">{r.lark ?? t.common.none}</TableCell>
              <TableCell className="text-right font-mono">{r.members}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
