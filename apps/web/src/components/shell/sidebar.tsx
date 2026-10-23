'use client';

import { LogOut, PanelLeftClose, PanelLeftOpen, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';
import { signOut } from './actions';
import { ADMIN_NAV, MAIN_NAV, type NavItem, STORE_KEYWORDS_NAV } from './nav';
import { type StoreOption, StoreSwitcher } from './store-switcher';

const KEY = 'ih.sidebar.collapsed';

/** The dark sidebar (spec §6): 248 px, 60 px collapsed, the state kept in local storage. */
/** `badges` by href: the shown briefing's date on Briefing, the store's New ideas on "Ý tưởng". */
export function Sidebar({ isAdmin, canKeywords, stores, storeId, badges = {} }: { isAdmin: boolean; canKeywords: boolean; stores: StoreOption[]; storeId: string | null; badges?: Record<string, string> }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === '1');
    } catch {
      // Storage blocked: stay expanded.
    }
  }, []);
  const toggle = () => {
    try {
      localStorage.setItem(KEY, collapsed ? '0' : '1');
    } catch {
      // Storage blocked: the toggle still works for this page.
    }
    setCollapsed(!collapsed);
  };
  return (
    <aside
      data-sidebar
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'bg-sidebar text-sidebar-fg mobile:hidden sticky top-0 flex h-screen shrink-0 flex-col transition-[width] duration-[var(--vet-sidebar-duration)]',
        collapsed ? 'w-[var(--vet-sidebar-w-collapsed)]' : 'w-[var(--vet-sidebar-w)]',
      )}
    >
      <div className="flex h-[var(--vet-header-h)] items-center justify-between gap-2 px-3">
        {collapsed ? null : <span className="text-brand text-[19px] font-bold">{t.app.name}</span>}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t.nav.expand : t.nav.collapse}
          aria-expanded={!collapsed}
          className="hover:bg-sidebar-hover rounded-control grid size-9 place-items-center"
        >
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2" aria-label={t.nav.main}>
        <NavGroup items={canKeywords ? [...MAIN_NAV, STORE_KEYWORDS_NAV] : MAIN_NAV} collapsed={collapsed} badges={badges} />
        {isAdmin ? <NavGroup label={t.nav.admin} items={ADMIN_NAV} collapsed={collapsed} /> : null}
      </nav>
      <div className="grid gap-1 p-2">
        <StoreSwitcher stores={stores} storeId={storeId} collapsed={collapsed} />
        <Link
          href="/account"
          aria-current={pathname === '/account' ? 'page' : undefined}
          aria-label={collapsed ? t.nav.account : undefined}
          className={cn(
            'rounded-control flex h-[var(--vet-nav-item-h)] items-center gap-2.5 px-2.5 text-[13px]',
            pathname === '/account' ? 'bg-sidebar-active text-sidebar-active-fg font-medium' : 'hover:bg-sidebar-hover',
          )}
        >
          <UserRound className="size-4 shrink-0" aria-hidden />
          {collapsed ? null : t.nav.account}
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            aria-label={collapsed ? t.nav.signOut : undefined}
            className="hover:bg-sidebar-hover rounded-control flex h-[var(--vet-nav-item-h)] w-full items-center gap-2.5 px-2.5 text-[13px]"
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            {collapsed ? null : t.nav.signOut}
          </button>
        </form>
      </div>
    </aside>
  );
}

function NavGroup({ label, items, collapsed, badges = {} }: { label?: string; items: NavItem[]; collapsed: boolean; badges?: Record<string, string> }) {
  const pathname = usePathname();
  return (
    <div className="mb-3">
      {label && !collapsed ? (
        <p className="text-sidebar-fg-muted px-2 pt-2 pb-1 text-[length:var(--vet-text-label-small)] font-semibold uppercase">{label}</p>
      ) : null}
      <ul className="grid gap-0.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Tooltip open={collapsed ? undefined : false}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      'rounded-control flex h-[var(--vet-nav-item-h)] items-center gap-2.5 px-2.5 text-[13px]',
                      active ? 'bg-sidebar-active text-sidebar-active-fg font-medium' : 'hover:bg-sidebar-hover',
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
                    {collapsed || !badges[item.href] ? null : <span className="rounded-pill border border-current px-1.5 font-mono text-[11px]">{badges[item.href]}</span>}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
