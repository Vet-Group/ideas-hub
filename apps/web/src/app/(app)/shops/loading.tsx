import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/strings.vi';

/** Skeletons with the page layout: a title, then a table of rows (spec §6 "Loading"). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label={t.common.loading}>
      <Skeleton className="mt-2 mb-4 h-8 w-48" />
      <div className="bg-surface border-line rounded-card grid gap-2 border p-3">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </div>
  );
}
