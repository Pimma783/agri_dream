import Link from 'next/link';
import { agreementListSchema } from '@agrimatch/contracts';
import { EmptyState, ErrorNotice } from '@/components/feedback';
import { GREEN, PageHead, Pill } from '@/components/factory/ui';
import { loadPageData, requireSession } from '@/lib/api-server';
import { agreementCode, fmtBaht, fmtNum, tonOf, valueOf } from '@/lib/factory-data';
import { formatDate } from '@/lib/format';
import { AGREEMENT_STATUS_TEXT, OFFER_KIND_LABEL, priceText } from '@/lib/offers';

export default async function OrdersPage() {
  const me = await requireSession();
  const { data, error } = await loadPageData('/agreements', agreementListSchema);
  return (
    <>
      <PageHead title="คำสั่งซื้อขาย" sub="ข้อตกลงที่ยืนยันแล้วทั้งหมดของคุณ" />
      {error ? <ErrorNotice error={error} /> : null}
      {data && data.length === 0 ? <EmptyState>ยังไม่มีข้อตกลง</EmptyState> : null}
      <div className="space-y-4">
        {(data ?? []).map((a) => (
          <article key={a.id} className="flex items-center justify-between gap-4 rounded-xl border border-[#e5eae3] bg-white p-4">
            <div>
              <Link href={`/factory/orders/${a.id}`} className="text-lg font-semibold text-[#17402a] underline">{agreementCode(a.id)}</Link>
              <p className="text-sm text-slate-500">{OFFER_KIND_LABEL[a.kind]} · {a.buyer_org_id === me.org_id ? 'ซื้อ' : 'ขาย'} · {formatDate(a.confirmed_at)}</p>
              <p className="text-sm text-slate-500">{fmtNum(tonOf(a.qty_kg), 1)} ตัน · {priceText(a.unit_price_thb, a.price_unit)}</p>
            </div>
            <div className="flex flex-col items-end gap-2"><b>{fmtBaht(valueOf(a))}</b><Pill status={AGREEMENT_STATUS_TEXT[a.status]} />
              <Link href={`/factory/orders/${a.id}`} className={`rounded px-3 py-1.5 text-xs ${GREEN}`}>ดูรายละเอียด</Link></div>
          </article>))}
      </div>
    </>
  );
}
