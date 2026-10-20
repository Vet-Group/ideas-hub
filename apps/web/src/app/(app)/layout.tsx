import { type ReactNode } from 'react';
import { AttentionBar } from '@/components/shell/attention-bar';
import { BottomTabs } from '@/components/shell/bottom-tabs';
import { CommandMenu } from '@/components/shell/command-menu';
import { Sidebar } from '@/components/shell/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { requireUser } from '@/lib/session';
import { userStores } from '@/lib/store';
import { t } from '@/lib/strings.vi';

/** Every signed-in page lives here; the session check repeats proxy.ts as defense in depth. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const { stores, selectedId } = await userStores(user);
  const isAdmin = user.role === 'admin';
  return (
    <TooltipProvider>
      <a href="#main" className="focus:bg-surface sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:p-2">
        {t.app.skipToContent}
      </a>
      <div className="flex min-h-screen">
        <Sidebar isAdmin={isAdmin} stores={stores} storeId={selectedId} />
        <div className="min-w-0 flex-1">
          <header className="bg-app sticky top-0 z-30 flex h-[var(--vet-header-h)] items-center justify-end gap-2 px-[var(--vet-main-pad-x)] mobile:h-[var(--vet-header-h-mobile)]">
            <CommandMenu isAdmin={isAdmin} />
          </header>
          {isAdmin ? <AttentionBar /> : null}
          <main id="main" tabIndex={-1} className="px-[var(--vet-main-pad-x)] pb-[calc(var(--vet-main-pad-y)+var(--vet-tabbar-h))] md:pb-[var(--vet-main-pad-y)]">
            {children}
          </main>
        </div>
      </div>
      <BottomTabs isAdmin={isAdmin} />
    </TooltipProvider>
  );
}
