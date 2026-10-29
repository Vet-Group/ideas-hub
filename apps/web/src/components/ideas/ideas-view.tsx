'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setStatusAction } from '@/app/(app)/ideas/actions';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/strings.vi';
import { IdeaBoard } from './idea-board';
import { IdeaTable } from './idea-table';
import { type Status } from './status-menu';
import { type IdeaItem } from './types';

const VIEW_KEY = 'ih-ideas-view';

/**
 * The ideas screen's two views; the toggle is kept in local storage (table by default) and in the URL
 * (`view=table|board`), which wins when present. The table shows the tab's status, the board all four.
 */
export function IdeasView({ ideas, canSave, view, tab, storeHasIdeas, clearHref }: { ideas: IdeaItem[]; canSave: boolean; view: 'table' | 'board' | null; tab: Status; storeHasIdeas: boolean; clearHref: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [items, setItems] = useState(ideas);
  const [pending, start] = useTransition();
  useEffect(() => setItems(ideas), [ideas]);

  const stored = () => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      return v === 'board' ? 'board' : 'table';
    } catch {
      return 'table';
    }
  };
  const [current, setCurrent] = useState<'table' | 'board'>(view ?? 'table');
  useEffect(() => setCurrent(view ?? stored()), [view]);

  const choose = (v: 'table' | 'board') => {
    setCurrent(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: the URL still carries the view.
    }
    const q = new URLSearchParams(params);
    q.set('view', v);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const onStatus = (id: string, s: Status) => {
    // A click while the last change is still being stored is ignored: the next step would build on an unconfirmed status.
    if (pending) return;
    const before = items;
    const expected = before.find((x) => x.id === id)?.status;
    if (!expected) return;
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status: s, updatedAt: new Date().toISOString() } : x)));
    start(async () => {
      if (await setStatusAction(id, s, expected)) toast.success(t.ideaViews.moved(t.ideaViews.statuses[s]!));
      else {
        setItems(before);
        toast.error(t.ideaViews.moveFailed);
        router.refresh();
      }
    });
  };

  return (
    <div className="grid gap-3">
      <div className="flex gap-1" role="group" aria-label={t.ideaViews.view}>
        <Button type="button" size="sm" variant={current === 'table' ? 'default' : 'ghost'} aria-pressed={current === 'table'} onClick={() => choose('table')}>
          {t.ideaViews.table}
        </Button>
        <Button type="button" size="sm" variant={current === 'board' ? 'default' : 'ghost'} aria-pressed={current === 'board'} onClick={() => choose('board')}>
          {t.ideaViews.board}
        </Button>
      </div>
      {current === 'table' ? (
        <IdeaTable ideas={items.filter((i) => i.status === tab)} canSave={canSave} onStatus={onStatus} storeHasIdeas={storeHasIdeas} clearHref={clearHref} />
      ) : (
        <IdeaBoard ideas={items} canSave={canSave} onStatus={onStatus} storeHasIdeas={storeHasIdeas} clearHref={clearHref} />
      )}
    </div>
  );
}
