import { agreementListSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { EmptyState, ErrorNotice } from '@/components/feedback';
import { AgreementCards, AgreementNotice } from '@/components/offer-views';
import { loadPageData, requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AgreementsPage() {
  await requireSession();
  const { data, error } = await loadPageData('/agreements', agreementListSchema);
  return (
    <div className="space-y-4">
      <PageTitle>ข้อตกลง</PageTitle>
      <AgreementNotice />
      {error ? <ErrorNotice error={error} /> : null}
      {data && data.length === 0 ? <EmptyState>ยังไม่มีข้อตกลง</EmptyState> : null}
      {data && data.length > 0 ? <AgreementCards items={data} /> : null}
    </div>
  );
}
