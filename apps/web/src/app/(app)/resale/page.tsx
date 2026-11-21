import { agreementListSchema, draftViewListSchema, listingViewListSchema } from '@agrimatch/contracts';
import { PageTitle } from '@/components/cards';
import { EmptyState, ErrorNotice, Notice } from '@/components/feedback';
import { ResaleDraftCards, ResaleListingCards } from '@/components/resale-views';
import { loadPageData, requireSession } from '@/lib/api-server';
import { openResaleDrafts, resaleListings } from '@/lib/resale';
export const dynamic = 'force-dynamic';
export default async function ResalePage() {
  const me = await requireSession();
  if (me.role !== 'BALER') return <Notice tone="warning">หน้านี้สำหรับผู้อัดฟางเท่านั้น</Notice>;
  const [drafts, listings, agreements] = await Promise.all([
    loadPageData('/drafts', draftViewListSchema),
    loadPageData('/listings', listingViewListSchema),
    loadPageData('/agreements', agreementListSchema),
  ]);
  const draftItems = drafts.data ? openResaleDrafts(drafts.data) : [];
  const listingItems = listings.data ? resaleListings(listings.data) : [];
  const refs = agreements.data ?? undefined;
  const empty = drafts.data !== null && listings.data !== null && draftItems.length === 0 && listingItems.length === 0;
  return (
    <div className="space-y-4">
      <PageTitle>ขายต่อ</PageTitle>
      <p className="text-sm text-slate-600">เริ่มจากหน้าข้อตกลงที่ยืนยันการซื้อแล้ว แล้วกด «สร้างประกาศขายต่อ»</p>
      {drafts.error ? <ErrorNotice error={drafts.error} /> : null}
      {listings.error ? <ErrorNotice error={listings.error} /> : null}
      {empty ? <EmptyState>ยังไม่มีประกาศขายต่อ</EmptyState> : null}
      {draftItems.length > 0 ? (
        <section aria-label="ร่าง" className="space-y-2">
          <h2 className="text-base font-semibold">ร่างที่ยังไม่เผยแพร่</h2>
          <ResaleDraftCards items={draftItems} {...(refs ? { agreements: refs } : {})} />
        </section>
      ) : null}
      {listingItems.length > 0 ? (
        <section aria-label="ประกาศที่เผยแพร่" className="space-y-2">
          <h2 className="text-base font-semibold">ประกาศที่เผยแพร่แล้ว</h2>
          <ResaleListingCards items={listingItems} {...(refs ? { agreements: refs } : {})} />
        </section>
      ) : null}
    </div>
  );
}
