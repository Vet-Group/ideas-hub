import Link from 'next/link';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** A column header that sorts on the server, with the sort in the URL (spec §6). */
export function SortHead({ label, sort, current, base, className }: { label: string; sort: string; current: string; base: string; className?: string }) {
  const active = sort === current;
  const href = `${base}${base.includes('?') ? '&' : '?'}sort=${sort}`;
  return (
    <TableHead aria-sort={active ? 'descending' : undefined} className={className}>
      <Link href={href} className={cn('underline-offset-2 hover:underline', active && 'font-semibold underline')}>
        {label}
        {active ? ' ↓' : ''}
      </Link>
    </TableHead>
  );
}
