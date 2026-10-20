'use server';

import { type SearchResults, SEARCH_PER_GROUP, globalSearch } from '@ideas-hub/db/queries';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { ADMIN_NAV, MAIN_NAV } from './nav';

export type MenuResults = SearchResults & { screens: { href: string; label: string }[] };

export async function searchMenu(query: string): Promise<MenuResults> {
  const user = await requireUser();
  const q = query.trim().toLowerCase();
  // Screens a member may not open (the "Quản trị" group) never show up.
  const screens = [...MAIN_NAV, ...(user.role === 'admin' ? ADMIN_NAV : [])]
    .filter((n) => n.label.toLowerCase().includes(q) || n.href.includes(q))
    .slice(0, SEARCH_PER_GROUP)
    .map((n) => ({ href: n.href, label: n.label }));
  return { ...(await globalSearch(db, query)), screens };
}
