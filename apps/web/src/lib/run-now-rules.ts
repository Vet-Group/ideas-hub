import { type Viewer, can } from '@ideas-hub/core';

/** Admins, and users with the `keywords` tick on a store that tracks the keyword (spec §4). */
export function mayRunNow(user: Viewer, keyword: { trackedBy: readonly string[] }): boolean {
  return user.role === 'admin' || keyword.trackedBy.some((storeId) => can(user, storeId, 'keywords'));
}
