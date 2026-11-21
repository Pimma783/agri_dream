import { matchListSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { EmptyState, ErrorNotice, Notice } from '@/components/feedback';
import { MatchCards } from '@/components/match-views';
import { loadPageData, requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function MatchesPage() {
  const me = await requireSession();
  if (me.role === 'FARMER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางและโรงงาน</Notice>;
  const { data, error } = await loadPageData('/matches', matchListSchema);
  return (
    <div className="space-y-4">
      <PageTitle>ผลจับคู่</PageTitle>
      {error ? <ErrorNotice error={error} /> : null}
      {data && data.length === 0 ? <EmptyState>ยังไม่มีผลจับคู่</EmptyState> : null}
      {data && data.length > 0 ? <MatchCards items={data} /> : null}
    </div>
  );
}
