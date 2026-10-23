import Link from 'next/link';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDayMonth } from '@/lib/format';
import { t } from '@/lib/strings.vi';
import { IdeasNothing } from './ideas-empty';
import { StatusMenu, type Status } from './status-menu';
import { type IdeaItem } from './types';

const ddmm = (iso: string) => formatDayMonth(new Date(iso));
// A manual idea is saved by hand too: its via would repeat its source.
const sourceLabel = (i: IdeaItem) => (i.via === i.source ? t.ideaViews.sources[i.source] : `${t.ideaViews.sources[i.source]} · ${t.ideaViews.via[i.via]}`);

/** The table view, as cards on a phone (spec §6 "Phones"); the status menu only for users with `save` on the store. */
export function IdeaTable({ ideas, canSave, onStatus, storeHasIdeas, clearHref }: { ideas: IdeaItem[]; canSave: boolean; onStatus: (id: string, s: Status) => void; storeHasIdeas: boolean; clearHref: string | null }) {
  if (ideas.length === 0) return <IdeasNothing storeHasIdeas={storeHasIdeas} clearHref={clearHref} />;
  const c = t.ideaViews.columns;
  const status = (i: IdeaItem) => (canSave ? <StatusMenu title={i.title} status={i.status} onChange={(s) => onStatus(i.id, s)} /> : t.ideaViews.statuses[i.status]);
  return (
    <>
      <ul className="grid gap-2 min-[821px]:hidden">
        {ideas.map((i) => (
          <li key={i.id} className="bg-surface border-line rounded-card grid gap-1 border p-3 text-sm">
            <Link href={`/ideas/${i.id}`} className="line-clamp-2 font-medium underline-offset-2 hover:underline">
              {i.title}
            </Link>
            <p className="text-fg-2">{[sourceLabel(i), i.keyword].filter(Boolean).join(' · ')}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-2">
                {i.assigneeName ?? t.ideaViews.nobody} · {ddmm(i.updatedAt)}
              </span>
              {status(i)}
            </div>
          </li>
        ))}
      </ul>
      <div className="max-[820px]:hidden">
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
                <TableCell className="text-fg-2 text-sm">{sourceLabel(i)}</TableCell>
                <TableCell>{i.keyword ?? t.common.none}</TableCell>
                <TableCell>{status(i)}</TableCell>
                <TableCell>{i.assigneeName ?? t.ideaViews.nobody}</TableCell>
                <TableCell>{i.createdByName}</TableCell>
                <TableCell>{ddmm(i.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
