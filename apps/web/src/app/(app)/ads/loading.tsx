import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/strings.vi';

/** Skeletons with the ads layout: filter rail, card grid and pane (spec §6 "Loading"). */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label={t.common.loading}>
      <Skeleton className="mt-2 mb-4 h-8 w-32" />
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_360px]">
        <div className="hidden gap-3 lg:grid">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full" />
          ))}
        </div>
        <Skeleton className="hidden h-96 xl:block" />
      </div>
    </div>
  );
}
