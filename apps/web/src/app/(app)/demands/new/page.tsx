import { BalerIntentPicker } from '@/components/baler-intent-picker';
import { PageTitle } from '@/components/cards';
import { Notice } from '@/components/feedback';
import { DemandForm } from '@/components/posting-form';
import { requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function NewDemandPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const me = await requireSession();
  if (me.role === 'FARMER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางและโรงงาน</Notice>;
  const { intent } = await searchParams;
  // A baler chooses between buying for resale and a baling service; there is no default.
  if (me.role === 'BALER' && intent !== 'resale') {
    return (
      <div className="space-y-4">
        <PageTitle>สร้างประกาศ</PageTitle>
        <BalerIntentPicker />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageTitle>สร้างประกาศรับซื้อ</PageTitle>
      <DemandForm resale={me.role === 'BALER'} />
    </div>
  );
}
