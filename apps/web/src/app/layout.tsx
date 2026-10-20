import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { type Metadata } from 'next';
import { type ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { t } from '@/lib/strings.vi';
import '../styles/theme.css';

export const metadata: Metadata = { title: t.app.name };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
