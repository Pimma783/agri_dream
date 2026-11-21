import { notFound } from 'next/navigation';
import { matchListSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { ErrorNotice, Notice } from '@/components/feedback';
import { MatchDetail } from '@/components/match-views';
import { loadPageData, requireSession } from '@/lib/api-server';
import { findMatch } from '@/lib/matches';

export const dynamic = 'force-dynamic';

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireSession();
  if (me.role === 'FARMER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางและโรงงาน</Notice>;
  const { id } = await params;
  // The API has no single-match endpoint; the list is the actor's own matches (max 100).
  const { data, error } = await loadPageData('/matches?limit=100', matchListSchema);
  const match = data ? findMatch(data, id) : undefined;
  if (data && !match) notFound();
  return (
    <div className="space-y-4">
      <PageTitle>รายละเอียดผลจับคู่</PageTitle>
      {error ? <ErrorNotice error={error} /> : null}
      {match ? <MatchDetail m={match} /> : null}
    </div>
  );
}
