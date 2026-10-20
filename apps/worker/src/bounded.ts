// briefing.build and lark.send run their queries under a 60 s statement_timeout, below the job's expiry,
// because pg-boss expiry does not stop a handler (plan Step 3 "Queues").
import { type Tx, withTx } from '@ideas-hub/db/client';
import type pg from 'pg';

export const STATEMENT_TIMEOUT_MS = 60_000;

export function bounded<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTx(pool, async (tx) => {
    await tx.client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    return fn(tx);
  });
}
