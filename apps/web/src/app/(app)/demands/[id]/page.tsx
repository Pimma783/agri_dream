import { purchaseDemandSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { ErrorNotice, Notice } from '@/components/feedback';
import { PostingActions } from '@/components/posting-actions';
import { DemandDetail } from '@/components/posting-views';
import { loadPageData, requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function DemandPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireSession();
  if (me.role === 'FARMER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางและโรงงาน</Notice>;
  const { id } = await params;
  const { data, error } = await loadPageData(`/purchase-demands/${encodeURIComponent(id)}`, purchaseDemandSchema);
  return (
    <div className="space-y-4">
      <PageTitle>ประกาศรับซื้อ</PageTitle>
      {error ? <ErrorNotice error={error} /> : null}
      {data ? (
        <>
          <DemandDetail d={data} />
          <PostingActions resource="purchase-demands" id={data.id} status={data.status} version={data.version} />
        </>
      ) : null}
    </div>
  );
}
