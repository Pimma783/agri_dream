import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { FactoryShell } from '@/components/factory/shell';

export const metadata: Metadata = { title: 'Agrimatch · พอร์ทัลโรงงาน', robots: { index: false, follow: false } };

export default function FactoryLayout({ children }: { children: ReactNode }) {
  return <FactoryShell>{children}</FactoryShell>;
}
