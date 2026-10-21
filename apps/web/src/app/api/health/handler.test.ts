import { createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { describe, expect, it } from 'vitest';
import { handleHealth } from './handler';

describe('GET /api/health', () => {
  it('answers 503 with no data when the query fails', async () => {
    const res = await handleHealth({ execute: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5433')) } as never);
    expect([res.status, await res.json(), res.headers.get('cache-control')]).toEqual([503, { ok: false }, 'no-store']);
  });

  it.skipIf(!testDatabaseAvailable())('answers 200 {"ok":true} after select 1', async () => {
    const { url, drop } = await createTestDatabase();
    const pool = createPool(url, 1);
    try {
      const res = await handleHealth(createDb(pool));
      expect([res.status, await res.text(), res.headers.get('cache-control')]).toEqual([200, '{"ok":true}', 'no-store']);
    } finally {
      await pool.end();
      await drop();
    }
  });
});
