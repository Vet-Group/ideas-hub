import { holidays } from '@ideas-hub/db';
import { asc } from 'drizzle-orm';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { addHoliday, deleteHoliday } from './actions';

const s = t.admin.holidays;

export default async function HolidaysPage() {
  await requireAdmin();
  const rows = await db.select().from(holidays).orderBy(asc(holidays.date));
  return (
    <>
      <PageHeader title={s.title} />
      <form action={addHoliday} className="bg-surface border-line rounded-card mb-4 flex flex-wrap items-end gap-3 border p-3">
        <div className="grid gap-1.5">
          <Label htmlFor="date">{s.date}</Label>
          <Input id="date" name="date" type="date" required />
        </div>
        <div className="grid min-w-60 flex-1 gap-1.5">
          <Label htmlFor="name">{s.name}</Label>
          <Input id="name" name="name" required />
        </div>
        <Button type="submit">{s.create}</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-fg-2">{s.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{s.date}</TableHead>
              <TableHead>{s.name}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="font-mono">{h.date}</TableCell>
                <TableCell>{h.name}</TableCell>
                <TableCell className="text-right">
                  <form action={deleteHoliday}>
                    <input type="hidden" name="id" value={h.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      {t.common.delete}
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
