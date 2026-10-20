import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidates, missingColors, uiFiles } from './check-ui-colors';

describe('check-ui-colors', () => {
  it('collects color-prefixed classes from string literals', () => {
    expect(candidates(`cn("bg-primary text-sm hover:bg-accent/50", 'p-2 ring-2')`)).toEqual(['bg-primary', 'text-sm', 'hover:bg-accent/50', 'ring-2']);
  });

  it('flags a color the theme does not map and passes mapped colors and non-color utilities', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ih-colors-'));
    const file = join(dir, 'x.tsx');
    writeFileSync(file, `const c = "bg-zinc-100 bg-primary text-muted-foreground text-sm ring-2 bg-black/50 text-white";`);
    expect((await missingColors([file])).map((m) => m.candidate)).toEqual(['bg-zinc-100']);
  });

  it('every color utility in the app produces CSS', async () => {
    const files = uiFiles();
    expect(files.some((f) => f.includes('components'))).toBe(true);
    expect(await missingColors(files)).toEqual([]);
  });
});
