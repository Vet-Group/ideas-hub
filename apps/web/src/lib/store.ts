import 'server-only';
import { storeScope } from '@ideas-hub/core';
import { stores } from '@ideas-hub/db';
import { asc, inArray } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db } from './db';
import { type CurrentUser } from './session';

export const STORE_COOKIE = 'ih_store';

/** The stores the user may view (admins: all), by name, and the selected one (cookie, else the first). */
export async function userStores(user: CurrentUser) {
  const scope = storeScope(user);
  const rows =
    scope.storeIds === 'all'
      ? await db.select({ id: stores.id, name: stores.name }).from(stores).orderBy(asc(stores.name))
      : scope.storeIds.length === 0
        ? []
        : await db.select({ id: stores.id, name: stores.name }).from(stores).where(inArray(stores.id, [...scope.storeIds])).orderBy(asc(stores.name));
  const wanted = (await cookies()).get(STORE_COOKIE)?.value;
  const selected = rows.find((s) => s.id === wanted) ?? rows[0] ?? null;
  return { stores: rows, selectedId: selected?.id ?? null };
}

/** The stores the user may save to (admins: all), for "Lưu". */
export async function saveTargets(user: CurrentUser) {
  const scope = storeScope(user, 'save');
  if (scope.storeIds !== 'all' && scope.storeIds.length === 0) return [];
  return scope.storeIds === 'all'
    ? db.select({ id: stores.id, name: stores.name }).from(stores).orderBy(asc(stores.name))
    : db.select({ id: stores.id, name: stores.name }).from(stores).where(inArray(stores.id, [...scope.storeIds])).orderBy(asc(stores.name));
}
