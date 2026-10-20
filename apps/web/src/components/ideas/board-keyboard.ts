// Keyboard moves on the ideas board (plan Step 6, spec §6 "Ideas"): with a card picked up, ← or → moves it
// one column, keeping its y clamped inside that column's visible rect so the page never scrolls; ↑ and ↓
// do nothing. @dnd-kit/core's default keyboard sensor moves 25 px per press instead (6.3.1
// `dist/core.esm.js` lines 1111 and 1121).
import { type KeyboardCoordinateGetter } from '@dnd-kit/core';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Where the card's top-left goes for one key press. `columns` are the droppable columns' rects, left to
 * right; `card` the card's current rect; `viewport` the visible area.
 */
export function nextCardPosition(key: string, card: Rect, columns: readonly Rect[], viewport: Rect): Point | null {
  const here: Point = { x: card.left, y: card.top };
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return key === 'ArrowUp' || key === 'ArrowDown' ? here : null;
  const center = card.left + card.width / 2;
  let index = columns.findIndex((c) => center >= c.left && center <= c.left + c.width);
  if (index < 0) index = columns.reduce((best, c, i) => (Math.abs(c.left - card.left) < Math.abs(columns[best]!.left - card.left) ? i : best), 0);
  const target = columns[key === 'ArrowRight' ? Math.min(index + 1, columns.length - 1) : Math.max(index - 1, 0)]!;
  // The column's visible part: its rect intersected with the viewport.
  const top = Math.max(target.top, viewport.top);
  const bottom = Math.min(target.top + target.height, viewport.top + viewport.height);
  const maxY = Math.max(top, bottom - card.height);
  return { x: target.left + Math.max(0, (target.width - card.width) / 2), y: Math.min(Math.max(card.top, top), maxY) };
}

/** The dnd-kit coordinate getter built on nextCardPosition, with columns read from the droppable rects. */
export function boardCoordinateGetter(columnIds: readonly string[]): KeyboardCoordinateGetter {
  return (event, { context, currentCoordinates }) => {
    const active = context.collisionRect ?? context.active?.rect.current.translated;
    if (!active) return undefined;
    const columns = columnIds.map((id) => context.droppableRects.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const next = nextCardPosition(event.code, active, columns, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    if (!next) return undefined;
    event.preventDefault();
    // dnd-kit coordinates are the pointer's; shift them by the card's move.
    return { x: currentCoordinates.x + (next.x - active.left), y: currentCoordinates.y + (next.y - active.top) };
  };
}
