'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DropdownMenu as M } from 'radix-ui';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';
import { selectStore } from './actions';

export interface StoreOption {
  id: string;
  name: string;
}

/** Lists only the stores the user may view (admins: all); sidebar tokens only. */
export function StoreSwitcher({ stores, storeId, collapsed }: { stores: StoreOption[]; storeId: string | null; collapsed: boolean }) {
  const router = useRouter();
  const current = stores.find((s) => s.id === storeId) ?? stores[0];
  const label = current?.name ?? t.nav.noStore;
  return (
    <M.Root>
      <M.Trigger
        className="hover:bg-sidebar-hover rounded-control flex h-10 w-full items-center gap-2 px-2.5 text-left text-[13px] disabled:cursor-default"
        aria-label={collapsed ? `${t.nav.store}: ${label}` : undefined}
        disabled={stores.length === 0}
      >
        <span className="bg-sidebar-badge text-sidebar-badge-fg grid size-6 shrink-0 place-items-center rounded-[4px] text-[11px] font-semibold">
          {label.slice(0, 1).toUpperCase()}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="text-sidebar-fg-muted block text-[length:var(--vet-text-label-small)]">{t.nav.store}</span>
              <span className="block truncate">{label}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0" aria-hidden />
          </>
        )}
      </M.Trigger>
      <M.Portal>
        <M.Content
          side="top"
          align="start"
          data-sidebar
          className="bg-sidebar text-sidebar-fg shadow-raised rounded-control z-50 min-w-56 p-1"
        >
          {stores.map((s) => (
            <M.Item
              key={s.id}
              onSelect={async () => {
                await selectStore(s.id);
                router.refresh();
              }}
              className="data-[highlighted]:bg-sidebar-hover rounded-control flex h-9 cursor-pointer items-center gap-2 px-2 text-[13px] outline-none"
            >
              <Check className={cn('size-4', s.id === current?.id ? 'opacity-100' : 'opacity-0')} aria-hidden />
              {s.name}
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
