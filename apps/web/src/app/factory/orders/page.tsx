import Link from 'next/link';
import { GREEN, PageHead, Thumb } from '@/components/factory/ui';
import { ORDERS, baht } from '@/lib/factory-mock';

export default function OrdersPage() {
  return (
    <>
      <PageHead title="คำสั่งซื้อขาย" sub="ติดตามคำสั่งซื้อทั้งหมดของคุณ" action={<select aria-label="ช่วงเวลา" className="rounded-lg border border-[#e5eae3] bg-white px-3 py-2 text-sm"><option>ทุกเวลา</option></select>} />
      <div className="space-y-4">
        {ORDERS.map((o) => (
          <article key={o.id} className="flex flex-col overflow-hidden rounded-xl border border-[#e5eae3] bg-white sm:flex-row">
            <Thumb tone={o.tone} className="h-36 sm:h-auto sm:w-56" />
            <div className="flex flex-1 flex-col justify-between p-4">
              <div className="flex justify-between gap-3">
                <div><Link href={`/factory/orders/${o.id}`} className="text-lg font-semibold text-[#17402a] underline">{o.material}</Link>
                  <p className="text-sm text-slate-500">{o.seller} · {o.from}</p><p className="text-sm text-slate-500">น้ำหนัก {o.qty} ตัน · {o.date}</p></div>
                <p className="shrink-0 font-semibold">{o.price.toLocaleString()} <span className="text-xs font-normal text-slate-400">บาท/ตัน</span></p>
              </div>
              <div className="mt-3 flex items-center justify-between"><span className="text-sm text-slate-500">รวม {baht(o.qty * o.price)}</span>
                <Link href={`/factory/orders/${o.id}`} className={`rounded px-3 py-1.5 text-xs ${GREEN}`}>ดูรายละเอียด</Link></div>
            </div>
          </article>))}
      </div>
    </>
  );
}
