import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t } from '@/lib/strings.vi';
import { StatusMenu, type Status } from './status-menu';
import { type IdeaItem } from './types';

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** The table view; the status menu only for users with `save` on the store. */
export function IdeaTable({ ideas, canSave, onStatus }: { ideas: IdeaItem[]; canSave: boolean; onStatus: (id: string, s: Status) => void }) {
  if (ideas.length === 0) return <p className="text-fg-2">{t.ideaViews.empty}</p>;
  const c = t.ideaViews.columns;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{c.title}</TableHead>
          <TableHead>{c.source}</TableHead>
          <TableHead>{c.keyword}</TableHead>
          <TableHead>{c.status}</TableHead>
          <TableHead>{c.assignee}</TableHead>
          <TableHead>{c.savedBy}</TableHead>
          <TableHead>{c.updated}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ideas.map((i) => (
          <TableRow key={i.id}>
            <TableCell className="max-w-80">
              <Link href={`/ideas/${i.id}`} className="line-clamp-2 font-medium underline-offset-2 hover:underline">
                {i.title}
              </Link>
            </TableCell>
            <TableCell className="text-fg-2 text-sm">
              {t.ideaViews.sources[i.source]} · {t.ideaViews.via[i.via]}
            </TableCell>
            <TableCell>{i.keyword ?? t.common.none}</TableCell>
            <TableCell>{canSave ? <StatusMenu title={i.title} status={i.status} onChange={(s) => onStatus(i.id, s)} /> : t.ideaViews.statuses[i.status]}</TableCell>
            <TableCell>{i.assigneeName ?? t.ideaViews.nobody}</TableCell>
            <TableCell>{i.createdByName}</TableCell>
            <TableCell>{ddmm(i.updatedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
