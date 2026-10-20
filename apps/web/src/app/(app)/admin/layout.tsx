import { type ReactNode } from 'react';
import { requireAdmin } from '@/lib/session';

/**
 * Admin pages answer 404 to anyone else (spec §6 "No permission"). The check sits in this layout, above
 * the `loading.tsx` boundaries, so the 404 status is sent before any skeleton streams.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return children;
}
