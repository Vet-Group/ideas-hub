import { crawlRuns, users } from '@ideas-hub/db';
import { desc, eq, sql } from 'drizzle-orm';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { now } from '@/lib/now';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';

const TONE: Record<string, string> = { done: 'text-success', running: 'text-warn', stopped: 'text-critical', missed: 'text-critical' };

/**
 * Run log for everyone; who triggered a manual run is shown to admins only (spec §6 "Roles"). The
 * scheduled runs are created days ahead, so the next 2 show apart and the log lists the rest by when they
 * ran or were due, newest first.
 */
export default async function RunsPage() {
  const user = await requireUser();
  const isAdmin = user.role === 'admin';
  const at = now();
  const all = await db
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
    .orderBy(desc(sql`coalesce(${crawlRuns.startedAt}, ${crawlRuns.scheduledFor}, ${crawlRuns.createdAt})`))
    .limit(200);
  const isUpcoming = (r: (typeof all)[number]) => r.status === 'scheduled' && !!r.scheduledFor && r.scheduledFor > at;
  const upcoming = all.filter(isUpcoming).reverse().slice(0, 2);
  const rows = all.filter((r) => !isUpcoming(r)).slice(0, 100);
  return (
    <>
      <PageHeader title={t.runs.title} />
      {upcoming.length ? (
        <p className="text-fg-2 mb-3 text-sm">
          {t.runs.next}: {upcoming.map((r) => formatDateTime(r.scheduledFor)).join(', ')}
        </p>
      ) : null}
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
                <TableCell className={cn('font-medium', TONE[r.status])}>{t.runs.statuses[r.status] ?? r.status}</TableCell>
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
