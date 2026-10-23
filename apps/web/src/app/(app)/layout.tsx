import { savedIdeas } from '@ideas-hub/db';
import { and, count, eq } from 'drizzle-orm';
import { type ReactNode } from 'react';
import { AttentionBar } from '@/components/shell/attention-bar';
import { HideOnAlertsPage } from '@/components/shell/hide-on-alerts-page';
import { BottomTabs } from '@/components/shell/bottom-tabs';
import { CommandMenu } from '@/components/shell/command-menu';
import { Sidebar } from '@/components/shell/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { latestReadyBriefing } from '@ideas-hub/db/queries';
import { vnDay } from '@/lib/briefing';
import { db } from '@/lib/db';
import { now } from '@/lib/now';
import { requireUser } from '@/lib/session';
import { userStores } from '@/lib/store';
import { t } from '@/lib/strings.vi';

/** Every signed-in page lives here; the session check repeats proxy.ts as defense in depth. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const { stores, selectedId } = await userStores(user);
  const isAdmin = user.role === 'admin';
  // `selectedId` is one of the user's own stores (userStores), so its count needs no further check.
  const [shown, [fresh]] = await Promise.all([
    latestReadyBriefing(db, vnDay(now())),
    selectedId ? db.select({ n: count() }).from(savedIdeas).where(and(eq(savedIdeas.storeId, selectedId), eq(savedIdeas.status, 'new'))) : [{ n: 0 }],
  ]);
  const badges: Record<string, string> = {};
  if (shown) badges['/briefing'] = `${shown.date.slice(8, 10)}/${shown.date.slice(5, 7)}`;
  if (fresh?.n) badges['/ideas'] = String(fresh.n);
  return (
    <TooltipProvider>
      <a href="#main" className="focus:bg-surface sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:p-2">
        {t.app.skipToContent}
      </a>
      <div className="flex min-h-screen">
        <Sidebar isAdmin={isAdmin} stores={stores} storeId={selectedId} badges={badges} />
        <div className="min-w-0 flex-1">
          <header className="bg-app sticky top-0 z-30 flex h-[var(--vet-header-h)] items-center justify-end gap-2 px-[var(--vet-main-pad-x)] mobile:h-[var(--vet-header-h-mobile)]">
            <CommandMenu isAdmin={isAdmin} />
          </header>
          {isAdmin ? (
            <HideOnAlertsPage>
              <AttentionBar />
            </HideOnAlertsPage>
          ) : null}
          <main id="main" tabIndex={-1} className="px-[var(--vet-main-pad-x)] pb-[calc(var(--vet-main-pad-y)+var(--vet-tabbar-h))] md:pb-[var(--vet-main-pad-y)]">
            {children}
          </main>
        </div>
      </div>
      <BottomTabs isAdmin={isAdmin} />
    </TooltipProvider>
  );
}
