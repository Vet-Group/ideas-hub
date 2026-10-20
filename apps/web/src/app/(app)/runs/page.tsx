import { crawlRuns, users } from '@ideas-hub/db';
import { desc, eq } from 'drizzle-orm';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';

/** Run log for everyone; who triggered a manual run is shown to admins only (spec §6 "Roles"). */
export default async function RunsPage() {
  const user = await requireUser();
  const isAdmin = user.role === 'admin';
  const rows = await db
    .select({
      id: crawlRuns.id,
      trigger: crawlRuns.trigger,
      status: crawlRuns.status,
      scheduledFor: crawlRuns.scheduledFor,
      startedAt: crawlRuns.startedAt,
      finishedAt: crawlRuns.finishedAt,
      planned: crawlRuns.plannedSearches,
      ok: crawlRuns.okSearches,
      runningAds: crawlRuns.runningAds,
      createdAt: crawlRuns.createdAt,
      triggeredBy: users.name,
    })
    .from(crawlRuns)
    .leftJoin(users, eq(users.id, crawlRuns.triggeredBy))
    .orderBy(desc(crawlRuns.createdAt))
    .limit(100);
  return (
    <>
      <PageHeader title={t.runs.title} />
      {rows.length === 0 ? (
        <p className="text-fg-2">{t.runs.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.runs.scheduledFor}</TableHead>
              <TableHead>{t.runs.trigger}</TableHead>
              <TableHead>{t.runs.status}</TableHead>
              <TableHead>{t.runs.started}</TableHead>
              <TableHead>{t.runs.finished}</TableHead>
              <TableHead className="text-right">{t.runs.searches}</TableHead>
              <TableHead className="text-right">{t.runs.runningAds}</TableHead>
              {isAdmin ? <TableHead>{t.runs.triggeredBy}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDateTime(r.scheduledFor ?? r.createdAt)}</TableCell>
                <TableCell>{t.runs.triggers[r.trigger] ?? r.trigger}</TableCell>
                <TableCell>{t.runs.statuses[r.status] ?? r.status}</TableCell>
                <TableCell>{formatDateTime(r.startedAt)}</TableCell>
                <TableCell>{formatDateTime(r.finishedAt)}</TableCell>
                <TableCell className="text-right font-mono">{r.ok === null ? t.common.none : `${r.ok}/${r.planned}`}</TableCell>
                <TableCell className="text-right font-mono">{r.runningAds ?? t.common.none}</TableCell>
                {isAdmin ? <TableCell>{r.triggeredBy ?? t.common.none}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
