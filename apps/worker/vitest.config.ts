import { defineConfig } from 'vitest/config';

// Integration tests run against a disposable database each, with pg-boss.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
