import { notFound } from 'next/navigation';
import { agreementViewSchema, draftViewSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { ErrorNotice, Notice } from '@/components/feedback';
import { ResaleEditor } from '@/components/resale-editor';
import { loadPageData, requireSession } from '@/lib/api-server';
import { maxResaleKg } from '@/lib/resale';
export const dynamic = 'force-dynamic';
export default async function ResaleDraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  const me = await requireSession();
  if (me.role !== 'BALER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางเท่านั้น</Notice>;
  const { draftId } = await params;
  const draft = await loadPageData(`/drafts/${encodeURIComponent(draftId)}`, draftViewSchema);
  if (draft.data && (draft.data.draft.kind !== 'RESALE_LISTING' || !draft.data.draft.source_agreement_id)) notFound();
  const sourceId = draft.data?.draft.source_agreement_id ?? null;
  const agreement = sourceId ? await loadPageData(`/agreements/${encodeURIComponent(sourceId)}`, agreementViewSchema) : null;
  const qty = typeof draft.data?.draft.data.qty_kg === 'string' ? draft.data.draft.data.qty_kg : null;
  return (
    <div className="space-y-4">
      <PageTitle>ร่างประกาศขายต่อ</PageTitle>
      {draft.error ? <ErrorNotice error={draft.error} /> : null}
      {agreement?.error ? <ErrorNotice error={agreement.error} /> : null}
      {draft.data && sourceId && agreement?.data ? (
        <ResaleEditor
          initial={draft.data}
          maxKg={maxResaleKg(agreement.data, draft.data.draft.status === 'CANCELLED' ? null : qty)}
          source={{ id: sourceId, confirmedAt: agreement.data.confirmed_at }}
        />
      ) : null}
    </div>
  );
}
