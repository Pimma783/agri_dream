import { offerViewSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { ErrorNotice } from '@/components/feedback';
import { OfferActionsPanel } from '@/components/offer-actions';
import { OfferDetail } from '@/components/offer-views';
import { loadPageData, requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const { data, error } = await loadPageData(`/offers/${encodeURIComponent(id)}`, offerViewSchema);
  return (
    <div className="space-y-4">
      <PageTitle>รายละเอียดข้อเสนอ</PageTitle>
      {error ? <ErrorNotice error={error} /> : null}
      {data ? (
        <>
          <OfferDetail o={data} />
          <OfferActionsPanel offer={data} />
        </>
      ) : null}
    </div>
  );
}
