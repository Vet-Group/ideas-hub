import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import uiStrings from './eslint-rules/ui-strings.mjs';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', 'packages/db/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/lib/strings.vi.ts'],
    plugins: { ih: { rules: { 'ui-strings': uiStrings } } },
    rules: { 'ih/ui-strings': 'error' },
  },
);
