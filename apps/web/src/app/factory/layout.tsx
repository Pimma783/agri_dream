import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { FactoryShell } from '@/components/factory/shell';
import { requireSession } from '@/lib/api-server';

export const metadata: Metadata = { title: 'Agrimatch · พอร์ทัลโรงงาน', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function FactoryLayout({ children }: { children: ReactNode }) {
  const me = await requireSession();
  return <FactoryShell orgName={me.org_name}>{children}</FactoryShell>;
}
