import { balingServiceSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { ErrorNotice, Notice } from '@/components/feedback';
import { PostingActions } from '@/components/posting-actions';
import { ServiceDetail } from '@/components/posting-views';
import { loadPageData, requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireSession();
  if (me.role !== 'BALER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางเท่านั้น</Notice>;
  const { id } = await params;
  const { data, error } = await loadPageData(`/baling-services/${encodeURIComponent(id)}`, balingServiceSchema);
  return (
    <div className="space-y-4">
      <PageTitle>บริการรับจ้างอัด</PageTitle>
      {error ? <ErrorNotice error={error} /> : null}
      {data ? (
        <>
          <ServiceDetail b={data} />
          <PostingActions resource="baling-services" id={data.id} status={data.status} version={data.version} />
        </>
      ) : null}
    </div>
  );
}
