import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/strings.vi';

/** Nothing on screen: the store's first-ideas hint, or, when it has ideas that the filters or the tab hide, a way back. */
export function IdeasNothing({ storeHasIdeas, clearHref }: { storeHasIdeas: boolean; clearHref: string | null }) {
  if (!storeHasIdeas) return <IdeasEmpty />;
  return (
    <div className="border-line rounded-card grid justify-items-start gap-3 border border-dashed p-4">
      <div>
        <p className="font-medium">{t.ideaViews.noMatch}</p>
        <p className="text-fg-2 text-sm">{t.ideaViews.noMatchHint}</p>
      </div>
      {clearHref ? (
        <Button asChild size="sm" variant="outline">
          <Link href={clearHref}>{t.ideaViews.clearFilters}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** The empty Ideas page: says where ideas come from and links there. */
export function IdeasEmpty() {
  return (
    <div className="border-line rounded-card grid justify-items-start gap-3 border border-dashed p-4">
      <div>
        <p className="font-medium">{t.ideaViews.empty}</p>
        <p className="text-fg-2 text-sm">{t.ideaViews.emptyHint}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/briefing">{t.ideaViews.openBriefing}</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/ads">{t.ideaViews.openAds}</Link>
        </Button>
      </div>
    </div>
  );
}
