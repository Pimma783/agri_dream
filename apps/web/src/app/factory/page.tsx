import Link from 'next/link';
import { BarChart, Card, PageHead, Pill, Stat, td, th } from '@/components/factory/ui';
import { MONTHLY, MONTHS, ORDERS, baht } from '@/lib/factory-mock';

export default function OverviewPage() {
  return (
    <>
      <PageHead title="ภาพรวมธุรกิจ" sub="ติดตามการรับซื้อ และการหมุนเวียนวัสดุเหลือใช้ทางการเกษตรของคุณ" action={<span className="rounded-lg border border-[#e5eae3] bg-white px-3 py-2 text-sm">📅 พฤศจิกายน 2569</span>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="ปริมาณรับซื้อ" value="248.0" unit="ตัน" note="↑ 12.7% จากเดือนก่อน" />
        <Stat label="ปริมาณขายต่อ" value="72.0" unit="ตัน" note="↑ 33.3% จากเดือนก่อน" />
        <Stat label="มูลค่าซื้อขาย" value="560,000" unit="บาท" note="↑ 18.6% จากเดือนก่อน" />
        <Stat label="คำสั่งซื้อที่กำลังดำเนินการ" value="18" unit="รายการ" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="font-semibold text-[#17402a]">ปริมาณซื้อขายวัสดุ</h2>
          <p className="mb-4 text-xs text-slate-500">6 เดือนล่าสุด (ตัน)</p>
          <BarChart labels={MONTHS} values={MONTHLY} height={190} />
        </Card>
        <Card className="bg-[#e8f1e3]">
          <h2 className="font-semibold text-[#17402a]">ทุกการซื้อขาย มีความหมาย</h2>
          <p className="mt-1 text-xs text-slate-600">วัสดุที่คุณรับซื้อช่วยลดการเผาในที่โล่ง</p>
          <p className="mt-6 text-5xl font-bold text-[#17402a]">320 <span className="text-lg font-normal">ตัน</span></p>
          <p className="mt-6 text-sm text-slate-600">คาร์บอนที่ลดได้โดยประมาณ</p>
          <p className="text-3xl font-bold text-[#1f6b43]">28.6 <span className="text-xs font-normal">tCO₂e</span></p>
        </Card>
      </div>
      <Card className="mt-4">
        <div className="mb-3 flex justify-between"><h2 className="font-semibold text-[#17402a]">คำสั่งซื้อล่าสุด</h2><Link href="/factory/orders" className="text-xs text-[#1f6b43]">ดูทั้งหมด →</Link></div>
        <table className="w-full"><thead><tr><th className={th}>รายการ</th><th className={th}>ผู้ขาย</th><th className={th}>ปริมาณ</th><th className={th}>มูลค่า</th><th className={th}>สถานะ</th></tr></thead>
          <tbody>{ORDERS.map((o) => (
            <tr key={o.id} className="border-t border-[#eef2ec]"><td className={td}><Link className="font-medium hover:underline" href={`/factory/orders/${o.id}`}>{o.material}</Link><br /><span className="text-xs text-slate-400">{o.code}</span></td>
              <td className={td}>{o.seller}</td><td className={td}>{o.qty} ตัน</td><td className={td}>{baht(o.qty * o.price)}</td><td className={td}><Pill status={o.status} /></td></tr>))}</tbody></table>
      </Card>
    </>
  );
}
