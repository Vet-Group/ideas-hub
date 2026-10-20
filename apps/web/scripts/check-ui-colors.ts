// pnpm --filter @ideas-hub/web check:ui-colors
// Compiles every color utility used in the app's .tsx files with Tailwind's compile() against theme.css and
// fails when one produces no CSS: theme.css resets Tailwind's palette, so a shadcn class naming a color
// the theme does not map (say `bg-zinc-100`) would silently render nothing. Utilities that are not
// colors (`text-sm`, `ring-2`) produce CSS, so they never trip it.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(root, 'src/styles');
const SRC = join(root, 'src');
const COLOR_PREFIX = /(?:^|:)!?-?(bg|text|border(?:-[trblxy])?|ring(?:-offset)?|fill|stroke|outline|from|to|via|accent|caret|decoration|divide|placeholder|shadow)-/;

/** Package stylesheets the theme imports, by their `style` export. */
const PACKAGE_CSS: Record<string, string> = {
  tailwindcss: 'node_modules/tailwindcss/index.css',
  'tw-animate-css': 'node_modules/tw-animate-css/dist/tw-animate.css',
};

async function loadStylesheet(id: string, base: string) {
  const path = PACKAGE_CSS[id] ? join(root, PACKAGE_CSS[id]) : resolve(base, id);
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
}

/** Class candidates in the string literals of a component file. */
export function candidates(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    for (const token of m[2]!.split(/\s+/)) if (COLOR_PREFIX.test(token)) out.add(token);
  }
  return [...out];
}

export async function missingColors(files: string[]): Promise<{ file: string; candidate: string }[]> {
  const compiler = await compile(readFileSync(join(STYLES, 'theme.css'), 'utf8'), { base: STYLES, loadStylesheet });
  const produces = new Map<string, boolean>();
  const missing: { file: string; candidate: string }[] = [];
  for (const file of files) {
    for (const c of candidates(readFileSync(file, 'utf8'))) {
      if (!produces.has(c)) {
        // build() keeps what it already generated, so the output grows only when a new candidate adds CSS.
        const before = compiler.build([]).length;
        produces.set(c, compiler.build([c]).length > before);
      }
      if (!produces.get(c)) missing.push({ file, candidate: c });
    }
  }
  return missing;
}

/** Every .tsx file under src: pages and shell components as well as src/components/ui. */
export const uiFiles = () =>
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(SRC, f));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = uiFiles();
  const missing = await missingColors(files);
  for (const m of missing) console.error(`${m.file.slice(root.length + 1)}: ${m.candidate} produces no CSS`);
  console.log(`checked ${files.length} files: ${missing.length ? `${missing.length} color utilities without CSS` : 'every color utility produces CSS'}`);
  process.exitCode = missing.length ? 1 : 0;
}
