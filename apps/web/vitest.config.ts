import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // tsconfig keeps jsx "preserve" for Next; tests that render a component need it compiled.
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
