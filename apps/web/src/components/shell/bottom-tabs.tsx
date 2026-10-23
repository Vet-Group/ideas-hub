'use client';

import { LogOut, MoreHorizontal, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';
import { signOut } from './actions';
import { ADMIN_NAV, MAIN_NAV } from './nav';

/** Phones (≤ 820 px): five tabs and "Khác", which holds the Run log, "Tài khoản" and, for admins, "Quản trị". */
export function BottomTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = MAIN_NAV.filter((n) => n.href !== '/runs');
  const more = [MAIN_NAV.find((n) => n.href === '/runs')!, ...(isAdmin ? ADMIN_NAV : [])];
  return (
    <nav
      aria-label={t.nav.main}
      className="bg-surface border-line fixed inset-x-0 bottom-0 z-40 hidden h-[var(--vet-tabbar-h)] border-t pb-[env(safe-area-inset-bottom)] mobile:flex"
    >
      {tabs.map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'text-ink font-semibold' : 'text-fg-2')}
          >
            <n.icon className="size-4" aria-hidden />
            {n.label}
          </Link>
        );
      })}
      <Sheet>
        <SheetTrigger className="text-fg-2 flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]">
          <MoreHorizontal className="size-4" aria-hidden />
          {t.nav.more}
        </SheetTrigger>
        <SheetContent side="bottom" className="pb-6">
          <SheetTitle className="px-4 pt-4">{t.nav.more}</SheetTitle>
          <ul className="grid gap-1 px-2">
            {more.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="hover:bg-selected rounded-control flex h-11 items-center gap-2.5 px-3 text-[14px]">
                  <n.icon className="size-4" aria-hidden />
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/account" className="hover:bg-selected rounded-control flex h-11 items-center gap-2.5 px-3 text-[14px]">
                <UserRound className="size-4" aria-hidden />
                {t.nav.account}
              </Link>
            </li>
            <li>
              <form action={signOut}>
                <button type="submit" className="hover:bg-selected rounded-control flex h-11 w-full items-center gap-2.5 px-3 text-[14px]">
                  <LogOut className="size-4" aria-hidden />
                  {t.nav.signOut}
                </button>
              </form>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
