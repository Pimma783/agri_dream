import Link from 'next/link';
import { purchaseDemandListSchema } from '@agrimatch/contracts';
import { BUTTON_CLASS, PageTitle } from '@/components/cards';
import { EmptyState, ErrorNotice, Notice } from '@/components/feedback';
import { DemandCards } from '@/components/posting-views';
import { loadPageData, requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function DemandsPage() {
  const me = await requireSession();
  if (me.role === 'FARMER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางและโรงงาน</Notice>;
  const { data, error } = await loadPageData('/purchase-demands', purchaseDemandListSchema);
  return (
    <div className="space-y-4">
      <PageTitle>{me.role === 'BALER' ? 'รับซื้อ' : 'ความต้องการรับซื้อ'}</PageTitle>
      <Link href="/demands/new" className={`${BUTTON_CLASS} w-full`}>
        + สร้างประกาศรับซื้อ
      </Link>
      {error ? <ErrorNotice error={error} /> : null}
      {data && data.length === 0 ? <EmptyState>ยังไม่มีประกาศรับซื้อ</EmptyState> : null}
      {data && data.length > 0 ? <DemandCards items={data} /> : null}
    </div>
  );
}
