'use client';

import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import { type CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { t } from '@/lib/strings.vi';

// Light only, without next-themes (plan Step 5); its transitions are capped at 220 ms in theme.css.
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="light"
    className="toaster group"
    containerAriaLabel={t.lib.toastRegion}
    toastOptions={{ closeButtonAriaLabel: t.lib.toastClose }}
    icons={{
      success: <CircleCheckIcon className="size-4" />,
      info: <InfoIcon className="size-4" />,
      warning: <TriangleAlertIcon className="size-4" />,
      error: <OctagonXIcon className="size-4" />,
    }}
    style={
      {
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--border-radius': 'var(--radius)',
      } as CSSProperties
    }
    {...props}
  />
);

export { Toaster };
