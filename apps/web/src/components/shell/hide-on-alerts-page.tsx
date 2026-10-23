'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

/** The attention bar links to the Alerts page, so it is redundant there. */
export function HideOnAlertsPage({ children }: { children: ReactNode }) {
  return usePathname() === '/admin/alerts' ? null : children;
}
