import { accounts, rateLimits, sessions, users, verifications } from '@ideas-hub/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { nanoid } from 'nanoid';
import { db } from './db';

const ID_PREFIX: Record<string, string> = { user: 'user', session: 'sess', account: 'acct', verification: 'verif', rateLimit: 'rl' };

// The app is reached only through its Cloudflare tunnel, which sets cf-connecting-ip to the client's address;
// x-forwarded-for carries whatever the client sent, so it is never read. TRUSTED_IP_HEADERS overrides the list.
const IP_HEADERS = (process.env.TRUSTED_IP_HEADERS || 'cf-connecting-ip')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// Session lifetime stays at better-auth's defaults (expiresIn 7 days, updateAge 1 day; 1.7.7
// dist/context/create-context.mjs lines 147–148), so a user who opens the app every morning stays signed in.
export const auth = betterAuth({
  baseURL: process.env.APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  telemetry: { enabled: false },
  database: drizzleAdapter(db, { provider: 'pg', usePlural: true, schema: { users, sessions, accounts, verifications, rateLimits } }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  advanced: {
    database: { generateId: ({ model }) => `${ID_PREFIX[model] ?? model}_${nanoid()}` },
    ipAddress: { ipAddressHeaders: IP_HEADERS },
  },
  // better-auth 1.7.7 turns its limiter on only in production and keeps it in memory; Postgres keeps the
  // counts across restarts. It covers /api/auth only: the login action has its own (lib/login-limit.ts).
  rateLimit: { enabled: true, storage: 'database' },
  plugins: [
    // Disabling a user is the admin plugin's ban, stored in users.disabled; banning deletes the sessions.
    admin({
      // Ideas Hub's roles are admin and member (users.role check); member has the plugin's user rights.
      roles: { admin: adminAc, member: userAc },
      defaultRole: 'member',
      adminRoles: ['admin'],
      schema: { user: { fields: { banned: 'disabled' } } },
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
