// The ops CLIs (phase 2 plan Step 2a), short-lived and without pg-boss; each loads the repo's .env first:
//   pnpm --silent ops:alert <kind> <dedupe_key> <detail>   insert an ops Alert; the watchdog posts it
//   pnpm --silent ops:quiet                                exit 0 when a deploy may restart units, 10 with the reasons
//   pnpm --silent ro-query < query.sql                     run the text as RO_DATABASE_URL's role, print CSV
//   pnpm --silent lark:post < message.txt                  post the text to the admin chat (no database)
// Exit 2 is a usage error; 1 any other failure, including an unreachable database.
import { text } from 'node:stream/consumers';
import { createDb, createPool, databaseUrl } from '@ideas-hub/db/client';
import { larkPost, opsAlert, quietReasons, roQuery } from './ops';

const RO_QUERY_TIMEOUT_MS = 60_000;

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // No .env: the environment has it.
}

async function withDb<T>(fn: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const pool = createPool(databaseUrl(), 1);
  try {
    return await fn(createDb(pool));
  } finally {
    await pool.end();
  }
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'alert') {
    if (args.length !== 3) {
      console.error('usage: pnpm ops:alert <kind> <dedupe_key> <detail>');
      process.exit(2);
    }
    const [kind, key, detail] = args as [string, string, string];
    console.log((await withDb((db) => opsAlert(db, kind, key, detail, new Date()))) ? `alert ${kind} ${key} inserted` : `alert ${kind} ${key} already there`);
  } else if (cmd === 'quiet') {
    const reasons = await withDb((db) => quietReasons(db, new Date()));
    for (const r of reasons) console.log(r);
    process.exitCode = reasons.length ? 10 : 0;
  } else if (cmd === 'ro-query') {
    const url = process.env.RO_DATABASE_URL;
    if (!url) throw new Error('RO_DATABASE_URL is not set');
    // A hard stop in case the cancel itself cannot get through.
    setTimeout(() => process.exit(1), RO_QUERY_TIMEOUT_MS + 15_000).unref();
    process.stdout.write(await roQuery(url, await text(process.stdin), RO_QUERY_TIMEOUT_MS));
  } else if (cmd === 'lark-post') {
    console.log(`posted ${await larkPost(await text(process.stdin))}`);
  } else {
    console.error('usage: ops-cli alert|quiet|ro-query|lark-post');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = e instanceof Error && e.message.startsWith('unknown ops Alert kind') ? 2 : 1;
}
