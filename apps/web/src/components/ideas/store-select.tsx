'use client';

import { useRouter } from 'next/navigation';
import { selectStore } from '@/components/shell/actions';
import { type StoreOption } from '@/components/shell/store-switcher';
import { t } from '@/lib/strings.vi';

/** Phones only (spec §6 "Phones"): the sidebar's store switcher is hidden there, so it sits in the Ideas header. */
export function StoreSelect({ stores, storeId }: { stores: StoreOption[]; storeId: string }) {
  const router = useRouter();
  return (
    <select
      aria-label={t.ideaViews.switchStore}
      value={storeId}
      onChange={async (e) => {
        // Read before the await: React puts the controlled value back once the handler returns.
        const id = e.target.value;
        await selectStore(id);
        router.push(`/ideas?store=${encodeURIComponent(id)}`);
      }}
      className="border-input bg-surface h-9 hidden max-w-full rounded-md border px-2 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50 mobile:block"
    >
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
