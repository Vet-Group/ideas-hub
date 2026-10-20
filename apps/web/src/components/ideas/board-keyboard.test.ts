import { describe, expect, it } from 'vitest';
import { nextCardPosition } from './board-keyboard';

// Four 200 px columns from x = 0, each 600 px tall from y = 100; the viewport shows y 0–500.
const columns = [0, 220, 440, 660].map((left) => ({ left, top: 100, width: 200, height: 600 }));
const viewport = { left: 0, top: 0, width: 900, height: 500 };
const card = (left: number, top: number) => ({ left, top, width: 180, height: 80 });

describe('nextCardPosition', () => {
  it('moves one column per ← or → press', () => {
    expect(nextCardPosition('ArrowRight', card(10, 200), columns, viewport)).toEqual({ x: 230, y: 200 });
    expect(nextCardPosition('ArrowRight', card(230, 200), columns, viewport)?.x).toBe(450);
    expect(nextCardPosition('ArrowLeft', card(450, 200), columns, viewport)?.x).toBe(230);
  });

  it('stays in the first and last column at the edges', () => {
    expect(nextCardPosition('ArrowLeft', card(10, 200), columns, viewport)?.x).toBe(10);
    expect(nextCardPosition('ArrowRight', card(670, 200), columns, viewport)?.x).toBe(670);
  });

  it('keeps y inside the next column’s visible rect, so the page never scrolls', () => {
    // Below the visible part (viewport ends at 500): clamped so the card's bottom stays at 500.
    expect(nextCardPosition('ArrowRight', card(10, 480), columns, viewport)?.y).toBe(420);
    // Above the column's top: clamped to it.
    expect(nextCardPosition('ArrowRight', card(10, 40), columns, viewport)?.y).toBe(100);
  });

  it('leaves the card in place on ↑ and ↓, and ignores other keys', () => {
    expect(nextCardPosition('ArrowUp', card(230, 200), columns, viewport)).toEqual({ x: 230, y: 200 });
    expect(nextCardPosition('ArrowDown', card(230, 200), columns, viewport)).toEqual({ x: 230, y: 200 });
    expect(nextCardPosition('KeyA', card(230, 200), columns, viewport)).toBeNull();
  });
});
