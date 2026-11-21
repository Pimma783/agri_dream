import Link from 'next/link';
import { offerListSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { EmptyState, ErrorNotice } from '@/components/feedback';
import { OfferCards } from '@/components/offer-views';
import { loadPageData, requireSession } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

const TAB =
  'inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border px-3 text-base font-medium';

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ direction?: string }> }) {
  await requireSession();
  const { direction } = await searchParams;
  const dir = direction === 'sent' ? 'sent' : 'received';
  const { data, error } = await loadPageData(`/offers?direction=${dir}`, offerListSchema);
  return (
    <div className="space-y-4">
      <PageTitle>ข้อเสนอ</PageTitle>
      <nav aria-label="กล่องข้อเสนอ" className="flex gap-2">
        <Link href="/offers?direction=received" aria-current={dir === 'received' ? 'page' : undefined} className={`${TAB} ${dir === 'received' ? 'border-emerald-700 bg-emerald-50' : 'border-slate-300 bg-white'}`}>
          ที่ได้รับ
        </Link>
        <Link href="/offers?direction=sent" aria-current={dir === 'sent' ? 'page' : undefined} className={`${TAB} ${dir === 'sent' ? 'border-emerald-700 bg-emerald-50' : 'border-slate-300 bg-white'}`}>
          ที่ส่งไป
        </Link>
      </nav>
      {error ? <ErrorNotice error={error} /> : null}
      {data && data.length === 0 ? <EmptyState>ยังไม่มีข้อเสนอ</EmptyState> : null}
      {data && data.length > 0 ? <OfferCards items={data} /> : null}
    </div>
  );
}
