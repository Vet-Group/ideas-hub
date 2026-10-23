import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';
import { boardCoordinateGetter } from './board-keyboard';
import { IdeasNothing } from './ideas-empty';
import { STATUSES, StatusMenu, type Status } from './status-menu';
import { type IdeaItem } from './types';

const COLUMN_IDS = STATUSES.map((s) => `col-${s}`);

/**
 * The Kanban board (spec §6 "Ideas"): four columns, cards newest first by `updated_at`, no position field,
 * so a drop sets only the status. Drag with a pointer, or Space, ← →, Space with the keyboard; every card
 * also has a status menu. Without `save`, or on a phone, there is no drag (and without `save` no menu).
 */
export function IdeaBoard({ ideas, canSave, onStatus, storeHasIdeas, clearHref }: { ideas: IdeaItem[]; canSave: boolean; onStatus: (id: string, s: Status) => void; storeHasIdeas: boolean; clearHref: string | null }) {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 820px)');
    const update = () => setPhone(m.matches);
    update();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, []);
  const drag = canSave && !phone;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: boardCoordinateGetter(COLUMN_IDS) }));
  const byStatus = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, ideas.filter((i) => i.status === s).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))])), [ideas]);
  const titleOf = (id: string | number) => ideas.find((i) => i.id === id)?.title ?? '';
  const columnOf = (id: string | number | undefined) => (id ? t.ideaViews.statuses[String(id).replace('col-', '')] ?? '' : '');

  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id ? (String(e.over.id).replace('col-', '') as Status) : null;
    const idea = ideas.find((i) => i.id === e.active.id);
    if (to && idea && idea.status !== to) onStatus(idea.id, to);
  };

  if (ideas.length === 0) return <IdeasNothing storeHasIdeas={storeHasIdeas} clearHref={clearHref} />;

  const board = (
    <div className={cn('grid gap-3', phone ? 'grid-cols-1' : 'grid-cols-4')} aria-describedby={drag ? 'board-help' : undefined}>
      {STATUSES.map((s) => (
        <Column key={s} status={s} count={byStatus[s]!.length}>
          {byStatus[s]!.map((i) => (
            <Card key={i.id} idea={i} drag={drag} canSave={canSave} onStatus={onStatus} />
          ))}
        </Column>
      ))}
    </div>
  );

  return (
    <>
      {drag ? (
        <p id="board-help" className="sr-only">
          {t.ideaViews.dragHelp}
        </p>
      ) : null}
      {drag ? (
        <DndContext
          sensors={sensors}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: { draggable: t.ideaViews.dragHelp },
            announcements: {
              onDragStart: ({ active }) => t.ideaViews.announce.start(titleOf(active.id)),
              onDragOver: ({ active, over }) => t.ideaViews.announce.over(titleOf(active.id), columnOf(over?.id)),
              onDragEnd: ({ active, over }) => t.ideaViews.announce.end(titleOf(active.id), columnOf(over?.id)),
              onDragCancel: ({ active }) => t.ideaViews.announce.cancel(titleOf(active.id)),
              onDragMove: () => undefined,
            },
          }}
        >
          {board}
        </DndContext>
      ) : (
        board
      )}
    </>
  );
}

function Column({ status, count, children }: { status: Status; count: number; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`col-title-${status}`} className="bg-app border-line rounded-card flex min-h-40 flex-col gap-2 border p-2">
      <h2 className="flex items-center justify-between text-sm font-semibold">
        {/* The region is named by the status alone; the count stays in the heading. */}
        <span id={`col-title-${status}`}>{t.ideaViews.statuses[status]}</span>
        <span className="text-fg-2 font-mono text-xs">{count}</span>
      </h2>
      <DropArea status={status}>{children}</DropArea>
    </section>
  );
}

function DropArea({ status, children }: { status: Status; children: React.ReactNode }) {
  // useDroppable only works inside a DndContext; outside one (no drag) it is a plain list.
  return <DroppableList id={`col-${status}`}>{children}</DroppableList>;
}

function DroppableList({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <ul ref={setNodeRef} className={cn('flex flex-1 flex-col gap-2 rounded-md', isOver && 'bg-selected')}>
      {children}
    </ul>
  );
}

function Card({ idea, drag, canSave, onStatus }: { idea: IdeaItem; drag: boolean; canSave: boolean; onStatus: (id: string, s: Status) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: idea.id, disabled: !drag });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <li ref={setNodeRef} style={style} className={cn('bg-surface border-line rounded-card grid gap-2 border p-2 text-sm', isDragging && 'relative z-20 shadow-lg')}>
      {drag ? (
        // The drag handle is the card's focusable surface; the title link and the menu stay separate controls.
        <button type="button" {...attributes} {...listeners} aria-roledescription={t.ideaViews.draggable} className="text-left font-medium outline-none focus:ring-[3px] focus:ring-ring/50 rounded-sm">
          {idea.title}
        </button>
      ) : (
        <span className="font-medium">{idea.title}</span>
      )}
      <div className="flex items-center justify-between gap-2">
        <Link href={`/ideas/${idea.id}`} aria-label={t.ideaViews.detailOf(idea.title)} className="text-fg-2 text-xs underline">
          {t.ideaViews.detail}
        </Link>
        {canSave ? <StatusMenu title={idea.title} status={idea.status} onChange={(s) => onStatus(idea.id, s)} /> : <span className="text-fg-2 text-xs">{t.ideaViews.statuses[idea.status]}</span>}
      </div>
    </li>
  );
}
