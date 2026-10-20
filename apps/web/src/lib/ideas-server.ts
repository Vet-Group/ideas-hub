import 'server-only';
import { type Viewer } from '@ideas-hub/core';
import { undoSave } from '@ideas-hub/db/queries';
import { db } from './db';
import { now } from './now';
import { objectStore } from './object-store';

/** "Hoàn tác" (plan Step 6 "Save"): deletes the ideas this save created, then their uploaded images. */
export async function undoIdeas(viewer: Viewer, ideaIds: string[]): Promise<{ ok: true } | { ok: false; reason: 'expired' }> {
  const r = await undoSave(db, viewer, ideaIds, now());
  if (!r.ok) return r;
  // The rows are gone either way; an object left behind is unreachable.
  if (r.imageKeys.length > 0) await objectStore.deleteObjects(r.imageKeys).catch((e: unknown) => console.error('undo: images not deleted', e));
  return { ok: true };
}
