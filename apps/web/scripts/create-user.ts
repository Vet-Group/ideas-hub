// pnpm auth:create-user --email <e> --name <n> [--role admin|member]
// Creates a user through better-auth's admin createUser (sign-up stays disabled). The password comes from
// IDEAS_HUB_NEW_PASSWORD, never an argument, so it does not land in the shell history.
import { parseArgs } from 'node:util';
import { auth } from '../src/lib/auth';
import { pool } from '../src/lib/db';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'member' } } });
const password = process.env.IDEAS_HUB_NEW_PASSWORD;
if (!values.email || !values.name || !password || !['admin', 'member'].includes(values.role!)) {
  console.error('usage: IDEAS_HUB_NEW_PASSWORD=… pnpm auth:create-user --email <e> --name <n> [--role admin|member]');
  process.exit(2);
}
try {
  const { user } = await auth.api.createUser({ body: { email: values.email, name: values.name, password, role: values.role as 'admin' | 'member' } });
  console.log(`created ${user.id} (${values.role})`);
} finally {
  await pool.end();
}
