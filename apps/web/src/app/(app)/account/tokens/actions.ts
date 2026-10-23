'use server';

import { type Viewer, inScope, storeScope } from '@ideas-hub/core';
import { TOKEN_SCOPES, apiTokens, storeMembers, stores, users } from '@ideas-hub/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TOKEN_DEFAULT_DAYS, TOKEN_MAX_DAYS, generateToken, hashToken } from '@/lib/api-v1/token';
import { db } from '@/lib/db';
import { now } from '@/lib/now';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';

const s = t.tokens;
const Create = z.object({
  name: z.string().trim().min(1, s.errors.name).max(80, s.errors.name),
  ownerId: z.string().max(100),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1, s.errors.scopes),
  storeIds: z.array(z.string().max(100)).max(200),
  days: z.coerce.number(s.errors.days).int(s.errors.days).min(1, s.errors.days).max(TOKEN_MAX_DAYS, s.errors.days),
});

export type CreateTokenState = { error: string } | { token: string; name: string } | null;

/**
 * Creates a token for the signed-in user, or, for an admin, for a service user that admin created. The token
 * is returned once; only its SHA-256 hash is stored. A store list may only name stores the owner can view.
 */
export async function createToken(_prev: CreateTokenState, form: FormData): Promise<CreateTokenState> {
  const me = await requireUser();
  const parsed = Create.safeParse({
    name: form.get('name') ?? '',
    ownerId: form.get('ownerId') ?? '',
    scopes: form.getAll('scopes'),
    storeIds: form.getAll('storeIds'),
    days: form.get('days') ?? TOKEN_DEFAULT_DAYS,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { name, scopes, days } = parsed.data;

  let owner: Viewer = me;
  if (parsed.data.ownerId && parsed.data.ownerId !== me.userId) {
    if (me.role !== 'admin') return { error: s.errors.owner };
    const [row] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, parsed.data.ownerId), eq(users.createdBy, me.userId), eq(users.disabled, false)));
    if (!row) return { error: s.errors.owner };
    const memberships = (await db.select().from(storeMembers).where(eq(storeMembers.userId, row.id))).map((m) => ({
      storeId: m.storeId,
      view: m.canView,
      save: m.canSave,
      keywords: m.canKeywords,
    }));
    owner = { userId: row.id, role: row.role === 'admin' ? 'admin' : 'member', memberships };
  }

  const storeIds = [...new Set(parsed.data.storeIds)];
  if (storeIds.length > 0) {
    const scope = storeScope(owner);
    const existing = await db.select({ id: stores.id }).from(stores).where(inArray(stores.id, storeIds));
    if (existing.length !== storeIds.length || !storeIds.every((id) => inScope(scope, id))) return { error: s.errors.stores };
  }

  const token = generateToken();
  const at = now();
  await db.insert(apiTokens).values({
    userId: owner.userId,
    createdBy: me.userId,
    name,
    tokenHash: hashToken(token),
    scopes,
    storeIds: storeIds.length > 0 ? storeIds : null,
    // created_at is set here too: the table checks the lifetime against it, and the app clock may differ from the database's.
    createdAt: at,
    expiresAt: new Date(at.getTime() + days * 86_400_000),
  });
  revalidatePath('/account/tokens');
  return { token, name };
}

/** Revokes a token of the signed-in user, or of a service user the signed-in admin created. */
export async function revokeToken(form: FormData) {
  const me = await requireUser();
  const tokenId = String(form.get('tokenId') ?? '');
  const [row] = await db
    .select({ ownerId: apiTokens.userId, ownerCreatedBy: users.createdBy })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.id, tokenId));
  if (!row || (row.ownerId !== me.userId && !(me.role === 'admin' && row.ownerCreatedBy === me.userId))) return;
  await db
    .update(apiTokens)
    .set({ revokedAt: now() })
    .where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)));
  revalidatePath('/account/tokens');
}
