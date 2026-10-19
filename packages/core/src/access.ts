// Per-store permission ticks and keyword-report visibility (spec §4).

export const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];
export type Permission = 'view' | 'save' | 'keywords';

export interface Membership {
  storeId: string;
  view: boolean;
  save: boolean;
  keywords: boolean;
}

export interface Viewer {
  userId: string;
  role: Role;
  memberships: readonly Membership[];
}

/** `save` and `keywords` each imply `view`. */
export function effectivePermissions(m: Membership): Record<Permission, boolean> {
  return { view: m.view || m.save || m.keywords, save: m.save, keywords: m.keywords };
}

export function can(viewer: Viewer, storeId: string, permission: Permission): boolean {
  if (viewer.role === 'admin') return true;
  const m = viewer.memberships.find((x) => x.storeId === storeId);
  return m ? effectivePermissions(m)[permission] : false;
}

/**
 * The AI sections of a keyword report: admins, everyone for seed keywords, otherwise users with
 * `view` on a store that tracks the keyword. Sections 1–4 and keyword text are shared and need no check.
 */
export function canSeeKeywordAi(
  viewer: Viewer,
  keyword: { origin: 'seed' | 'store'; trackedBy: readonly string[] },
): boolean {
  if (viewer.role === 'admin' || keyword.origin === 'seed') return true;
  return keyword.trackedBy.some((storeId) => can(viewer, storeId, 'view'));
}

declare const storeScopeBrand: unique symbol;

/**
 * The stores a query may read or write for one viewer. Only `storeScope` builds it, so a store-scoped
 * query cannot be called without an access check.
 */
export type StoreScope = {
  readonly [storeScopeBrand]: true;
  readonly permission: Permission;
  /** `all` for admins. */
  readonly storeIds: 'all' | readonly string[];
};

export function storeScope(viewer: Viewer, permission: Permission = 'view'): StoreScope {
  const storeIds =
    viewer.role === 'admin'
      ? 'all'
      : viewer.memberships.filter((m) => effectivePermissions(m)[permission]).map((m) => m.storeId);
  return { permission, storeIds } as StoreScope;
}

export function inScope(scope: StoreScope, storeId: string): boolean {
  return scope.storeIds === 'all' || scope.storeIds.includes(storeId);
}
