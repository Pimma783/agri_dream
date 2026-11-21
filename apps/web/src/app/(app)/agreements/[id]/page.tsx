import { agreementViewSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { ErrorNotice } from '@/components/feedback';
import { AgreementDetail } from '@/components/offer-views';
import { ResaleDraftButton } from '@/components/resale-draft-button';
import { loadPageData, requireSession } from '@/lib/api-server';
import { canCreateResale, remainingKg } from '@/lib/offers';

export const dynamic = 'force-dynamic';

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireSession();
  const { id } = await params;
  const { data, error } = await loadPageData(`/agreements/${encodeURIComponent(id)}`, agreementViewSchema);
  return (
    <div className="space-y-4">
      <PageTitle>รายละเอียดข้อตกลง</PageTitle>
      {error ? <ErrorNotice error={error} /> : null}
      {data ? (
        <>
          <AgreementDetail a={data} side={data.buyer_org_id === me.org_id ? 'buyer' : 'seller'} />
          {canCreateResale(data, me) ? (
            <ResaleDraftButton agreementId={data.id} disabled={Number(remainingKg(data.qty_kg, data.resale_reserved_kg)) <= 0} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
