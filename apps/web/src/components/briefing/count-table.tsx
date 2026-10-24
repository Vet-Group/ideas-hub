import { type BriefingCount } from '@ideas-hub/core';
import Link from 'next/link';
import { DeltaLabel } from '@/components/states/delta-label';
import { sharedBaseline } from '@/lib/delta';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t } from '@/lib/strings.vi';

/**
 * Sections 3 and 4: running ads per keyword or domain, with the change. A baseline label all rows share
 * is stated once under the table instead of on every row, which kept each phone row five lines tall.
 */
export function CountTable({ rows, head, href }: { rows: BriefingCount[]; head: string; href: (key: string) => string }) {
  if (rows.length === 0) return <p className="text-fg-2 text-sm">{t.briefing.empty}</p>;
  const shared = sharedBaseline(rows.map((r) => r.delta));
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{head}</TableHead>
            <TableHead className="text-right">{t.shops.runningAds}</TableHead>
            <TableHead>{t.briefing.kpi.change}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell>
                <Link href={href(r.key)} className="underline-offset-2 hover:underline">
                  {r.label}
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono">{r.runningAds}</TableCell>
              <TableCell className={shared ? undefined : 'whitespace-normal'}>
                <DeltaLabel delta={r.delta} bare={shared !== null} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {shared ? <p className="text-fg-muted text-xs">{t.briefing.changeSince(shared)}</p> : null}
    </>
  );
}
