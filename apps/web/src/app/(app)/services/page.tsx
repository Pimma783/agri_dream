import Link from 'next/link';
import { balingServiceListSchema } from '@agrimatch/contracts';
import { BUTTON_CLASS, PageTitle } from '@/components/cards';
import { EmptyState, ErrorNotice, Notice } from '@/components/feedback';
import { ServiceCards } from '@/components/posting-views';
import { loadPageData, requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const me = await requireSession();
  if (me.role !== 'BALER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางเท่านั้น</Notice>;
  const { data, error } = await loadPageData('/baling-services', balingServiceListSchema);
  return (
    <div className="space-y-4">
      <PageTitle>รับจ้างอัด</PageTitle>
      <Link href="/services/new" className={`${BUTTON_CLASS} w-full`}>
        + สร้างบริการรับจ้างอัด
      </Link>
      {error ? <ErrorNotice error={error} /> : null}
      {data && data.length === 0 ? <EmptyState>ยังไม่มีบริการรับจ้างอัด</EmptyState> : null}
      {data && data.length > 0 ? <ServiceCards items={data} /> : null}
    </div>
  );
}
