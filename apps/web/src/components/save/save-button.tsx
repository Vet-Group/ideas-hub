'use client';

import { Bookmark } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type Ref, useImperativeHandle, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { type SaveOutcome, type SaveSource, lastStoresAction, saveAction, undoAction } from '@/app/(app)/ideas/actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { t } from '@/lib/strings.vi';

export interface SaveTarget {
  id: string;
  name: string;
}

export interface SaveHandle {
  /** `S` on a focused card: saves at once with one store, opens the store picker with several. */
  trigger(): void;
}

type Results = Extract<SaveOutcome, { ok: true }>['results'];

const ideaHref = (r: { storeId: string; ideaId: string }) => `/ideas/${r.ideaId}`;

/**
 * "Lưu" (spec §4 "Save-idea flow"): with `save` on one store it saves in 1 action; with several, a
 * popover pre-checked with the stores of the user's last save and Enter (2 actions), a result per store,
 * then the toast with "Hoàn tác" and "Thêm store khác". Nothing renders without `save` on any store.
 */
export function SaveButton({ source, stores, ref, compact }: { source: SaveSource; stores: SaveTarget[]; ref?: Ref<SaveHandle>; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const [pending, start] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const openPicker = () => {
    setResults(null);
    start(async () => {
      const last = (await lastStoresAction()).filter((id) => stores.some((s) => s.id === id));
      setChecked(last);
      setOpen(true);
    });
  };

  const save = (storeIds: string[]) =>
    start(async () => {
      const r = await saveAction(source, storeIds);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (stores.length > 1) setResults(r.results);
      const created = r.results.filter((x) => x.created);
      const names = r.results.map((x) => x.storeName).join(', ');
      toast.success(created.length ? t.save.savedTo(names) : t.save.existing, {
        duration: 10_000,
        action: created.length
          ? {
              label: t.save.undo,
              onClick: async () => {
                const u = await undoAction(created.map((x) => x.ideaId));
                if (u.ok) toast(t.save.undone);
                else toast.error(u.error ?? t.save.expired);
              },
            }
          : { label: t.save.open, onClick: () => router.push(ideaHref(r.results[0]!)) },
        cancel: stores.length > 1 ? { label: t.save.addStore, onClick: () => openPicker() } : undefined,
      });
    });

  useImperativeHandle(ref, () => ({ trigger: () => (stores.length === 1 ? save([stores[0]!.id]) : openPicker()) }));

  if (stores.length === 0) return null;
  const label = (
    <>
      <Bookmark aria-hidden />
      {compact ? <span className="sr-only">{t.save.button}</span> : t.save.button}
    </>
  );
  if (stores.length === 1) {
    return (
      <Button ref={button} type="button" size="sm" variant="outline" disabled={pending} onClick={() => save([stores[0]!.id])}>
        {label}
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={(o) => (o ? openPicker() : setOpen(false))}>
      <PopoverTrigger asChild>
        <Button ref={button} type="button" size="sm" variant="outline" disabled={pending}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(checked);
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t.save.pickStores}</legend>
            {stores.map((s) => {
              const r = results?.find((x) => x.storeId === s.id);
              return (
                <div key={s.id} className="flex min-h-6 items-center justify-between gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={checked.includes(s.id)}
                      onCheckedChange={(v) => setChecked((c) => (v ? [...c, s.id] : c.filter((x) => x !== s.id)))}
                      // Enter in the list saves, as the button does.
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          save(checked);
                        }
                      }}
                    />
                    {s.name}
                  </label>
                  {r ? (
                    r.created ? (
                      <span className="text-success text-xs">{t.save.created}</span>
                    ) : (
                      <Link href={ideaHref(r)} className="text-xs underline">
                        {t.save.existing} · {t.save.open}
                      </Link>
                    )
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          <Button type="submit" size="sm" className="mt-3 w-full" disabled={pending || checked.length === 0}>
            {t.save.confirm}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
