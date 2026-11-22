import Link from 'next/link';
import { agreementViewSchema } from '@agrimatch/contracts';
import { ErrorNotice } from '@/components/feedback';
import { Card, PageHead, Pill } from '@/components/factory/ui';
import { loadPageData, requireSession } from '@/lib/api-server';
import { agreementCode, fmtBaht, fmtNum, tonOf, valueOf } from '@/lib/factory-data';
import { formatDateTime } from '@/lib/format';
import { AGREEMENT_NOTICE, AGREEMENT_STATUS_TEXT, OFFER_KIND_LABEL, priceText } from '@/lib/offers';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireSession();
  const { data: a, error } = await loadPageData(`/agreements/${encodeURIComponent(id)}`, agreementViewSchema);
  return (
    <>
      <Link href="/factory/orders" className="text-xs text-[#1f6b43]">← กลับไปคำสั่งซื้อ</Link>
      {error ? <ErrorNotice error={error} /> : null}
      {a ? (
        <>
          <PageHead title={`ข้อตกลง ${agreementCode(a.id)}`} sub={`ยืนยันเมื่อ ${formatDateTime(a.confirmed_at)}`} action={<Pill status={AGREEMENT_STATUS_TEXT[a.status]} />} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h2 className="mb-3 font-semibold text-[#17402a]">รายการ</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-slate-400">ประเภท</dt><dd>{OFFER_KIND_LABEL[a.kind]}</dd></div>
                <div><dt className="text-xs text-slate-400">ฝั่งของคุณ</dt><dd>{a.buyer_org_id === me.org_id ? 'ผู้ซื้อ' : 'ผู้ขาย'}</dd></div>
                <div><dt className="text-xs text-slate-400">ปริมาณ</dt><dd>{fmtNum(tonOf(a.qty_kg), 2)} ตัน</dd></div>
                <div><dt className="text-xs text-slate-400">ราคา</dt><dd>{priceText(a.unit_price_thb, a.price_unit)}</dd></div>
              </dl>
              <div className="mt-5 flex justify-between border-t pt-4 text-lg font-bold"><span>รวมราคาทั้งหมด</span><span>{fmtBaht(valueOf(a))}</span></div>
            </Card>
            <Card><h2 className="mb-2 font-semibold text-[#17402a]">หมายเหตุ</h2><p className="text-sm text-slate-600">{AGREEMENT_NOTICE}</p>
              <Link href={`/agreements/${a.id}`} className="mt-3 inline-block text-xs text-[#1f6b43] underline">เปิดในมุมมองเดิม</Link></Card>
          </div>
        </>
      ) : null}
    </>
  );
}
