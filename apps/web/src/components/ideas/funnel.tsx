import { type IdeaFunnelWeek } from '@ideas-hub/db/queries';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ddmm } from '@/lib/format';
import { t } from '@/lib/strings.vi';

/** The store's weekly funnel (saved, picked, done, median days to done); collapsed so the list stays first. */
export function IdeaFunnel({ weeks }: { weeks: IdeaFunnelWeek[] }) {
  const f = t.ideaViews.funnel;
  return (
    <details className="mt-6" data-testid="idea-funnel">
      <summary className="cursor-pointer text-sm font-medium">{f.title}</summary>
      <p className="text-fg-2 my-2 text-sm">{f.help}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{f.week}</TableHead>
            <TableHead className="text-right">{f.saved}</TableHead>
            <TableHead className="text-right">{f.picked}</TableHead>
            <TableHead className="text-right">{f.done}</TableHead>
            <TableHead className="text-right">{f.median}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {weeks.map((w) => (
            <TableRow key={w.weekStart}>
              <TableCell>{ddmm(w.weekStart)}</TableCell>
              <TableCell className="text-right font-mono">{w.saved}</TableCell>
              <TableCell className="text-right font-mono">{w.picked}</TableCell>
              <TableCell className="text-right font-mono">{w.done}</TableCell>
              <TableCell className="text-right font-mono">{w.medianDays === null ? t.common.none : String(w.medianDays).replace('.', ',')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </details>
  );
}
