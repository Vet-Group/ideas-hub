import { adminAlerts } from '@ideas-hub/db/queries';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { resolveAlert, resolveAllAlerts } from './actions';

const s = t.admin.alerts;

/** Open Alerts first, then the latest resolved ones. */
export default async function AlertsPage() {
  await requireAdmin();
  const rows = await adminAlerts(db);
  const open = rows.filter((a) => a.resolvedAt === null).length;
  return (
    <>
      <PageHeader title={s.title}>
        {open > 0 ? (
          <form action={resolveAllAlerts}>
            <Button type="submit" size="sm" variant="outline">
              {s.resolveAll}
            </Button>
          </form>
        ) : null}
      </PageHeader>
      {rows.length === 0 || open === 0 ? <p className="text-fg-2 mb-3">{s.empty}</p> : null}
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{s.created}</TableHead>
              <TableHead>{s.kind}</TableHead>
              <TableHead>{s.run}</TableHead>
              <TableHead>{s.detail}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{formatDateTime(a.createdAt)}</TableCell>
                <TableCell>{s.kinds[a.kind] ?? a.kind}</TableCell>
                <TableCell className="font-mono">{a.runId ?? t.common.none}</TableCell>
                <TableCell className="max-w-[32rem] min-w-48 break-words whitespace-pre-wrap">
                  {a.detail ?? t.common.none}
                </TableCell>
                <TableCell className="text-right">
                  {a.resolvedAt ? (
                    <span className="text-fg-2">{`${s.resolved} ${formatDateTime(a.resolvedAt)}`}</span>
                  ) : (
                    <form action={resolveAlert}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button type="submit" size="sm" variant="outline">
                        {s.resolve}
                      </Button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}
