import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import './globals.css';

export const metadata = { title: 'Agrimatch' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
