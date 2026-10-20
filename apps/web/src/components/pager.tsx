import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/strings.vi';

/** Previous and next page links; `href` builds a page's URL with the rest of the query kept. */
export function Pager({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  // A page past the end (an old link) still gets the way back.
  if (pageCount <= 1 && page <= 1) return null;
  return (
    <nav aria-label={t.common.pages} className="mt-4 flex items-center justify-center gap-3 text-sm">
      {page > 1 ? (
        <Button asChild size="sm" variant="outline">
          <Link href={href(Math.min(page - 1, pageCount))}>{t.common.prevPage}</Link>
        </Button>
      ) : null}
      <span className="text-fg-2">{t.common.pageOf(page, pageCount)}</span>
      {page < pageCount ? (
        <Button asChild size="sm" variant="outline">
          <Link href={href(page + 1)}>{t.common.nextPage}</Link>
        </Button>
      ) : null}
    </nav>
  );
}
