import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidates, compileTheme, missingColors, uiFiles } from './check-ui-colors';

describe('check-ui-colors', () => {
  it('collects color-prefixed classes from string literals', () => {
    expect(candidates(`cn("bg-primary text-sm hover:bg-accent/50", 'p-2 ring-2')`)).toEqual(['bg-primary', 'text-sm', 'hover:bg-accent/50', 'ring-2']);
  });

  it('splits JSX caught between two strings into class-like tokens', () => {
    expect(candidates(`<p className="a">{x}</p><p className="text-sm">{y}</p>`)).toEqual(['text-sm']);
  });

  it('flags a color the theme does not map and passes mapped colors and non-color utilities', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ih-colors-'));
    const file = join(dir, 'x.tsx');
    writeFileSync(file, `const c = "bg-zinc-100 bg-primary text-muted-foreground text-sm ring-2 bg-black/50 text-white";`);
    expect((await missingColors([file])).map((m) => m.candidate)).toEqual(['bg-zinc-100']);
  });

  it("shadcn's muted is the selected background, and POD's muted text is text-fg-muted (plan Step 5)", async () => {
    const compiler = await compileTheme();
    const decl = (cls: string) => compiler.build([cls]).match(new RegExp(String.raw`\.${cls}\s*\{([^}]*)\}`))?.[1]?.trim();
    expect(decl('bg-muted')).toBe('background-color: var(--vet-bg-selected);');
    expect(decl('text-fg-muted')).toBe('color: var(--vet-text-muted);');
    expect(decl('text-muted-foreground')).toBe('color: var(--vet-text-muted);');
  });

  it('every color utility in the app produces CSS', async () => {
    const files = uiFiles();
    expect(files.some((f) => f.includes('components'))).toBe(true);
    expect(await missingColors(files)).toEqual([]);
  });
});
