import { matchListSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { EmptyState, ErrorNotice, Notice } from '@/components/feedback';
import { CreateOfferForm } from '@/components/offer-form';
import { loadPageData, requireSession } from '@/lib/api-server';
import { findMatch } from '@/lib/matches';

export const dynamic = 'force-dynamic';

export default async function NewOfferPage({ searchParams }: { searchParams: Promise<{ match_id?: string }> }) {
  const me = await requireSession();
  if (me.role === 'FARMER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางและโรงงาน</Notice>;
  const { match_id: matchId } = await searchParams;
  if (!matchId) return <EmptyState>เลือกผลจับคู่ก่อนเริ่มเสนอข้อตกลง</EmptyState>;
  const { data, error } = await loadPageData('/matches?limit=100', matchListSchema);
  const match = data ? findMatch(data, matchId) : undefined;
  return (
    <div className="space-y-4">
      <PageTitle>เสนอข้อตกลง</PageTitle>
      {error ? <ErrorNotice error={error} /> : null}
      {data && !match ? <EmptyState>ไม่พบผลจับคู่นี้</EmptyState> : null}
      {match ? <CreateOfferForm match={match} /> : null}
    </div>
  );
}
