import Link from 'next/link';
import { agreementListSchema, matchListSchema, offerListSchema } from '@agrimatch/contracts';
import { ErrorNotice } from '@/components/feedback';
import { BarChart, Card, PageHead, Pill, Stat, td, th } from '@/components/factory/ui';
import { loadPageData, requireSession } from '@/lib/api-server';
import { agreementCode, fmtBaht, fmtNum, monthly, summarize, tonOf, valueOf } from '@/lib/factory-data';
import { AGREEMENT_STATUS_TEXT } from '@/lib/offers';

export default async function OverviewPage() {
  const me = await requireSession();
  const [ag, offers, matches] = await Promise.all([
    loadPageData('/agreements', agreementListSchema),
    loadPageData('/offers?status=PENDING', offerListSchema),
    loadPageData('/matches', matchListSchema),
  ]);
  const s = summarize(ag.data ?? [], me.org_id);
  const chart = monthly(s.live, (a) => tonOf(a.qty_kg));
  const latest = [...s.live].sort((a, b) => b.confirmed_at.localeCompare(a.confirmed_at)).slice(0, 5);
  return (
    <>
      <PageHead title="ภาพรวมธุรกิจ" sub="ติดตามการรับซื้อและการหมุนเวียนวัสดุเหลือใช้ทางการเกษตรของคุณ" />
      {ag.error ? <ErrorNotice error={ag.error} /> : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="ปริมาณรับซื้อ" value={fmtNum(s.boughtTon, 1)} unit="ตัน" />
        <Stat label="ปริมาณขายต่อ" value={fmtNum(s.soldTon, 1)} unit="ตัน" />
        <Stat label="มูลค่าซื้อขาย" value={fmtNum(s.totalValue)} unit="บาท" />
        <Stat label="ข้อเสนอที่รอตอบรับ" value={String(offers.data?.length ?? 0)} unit="รายการ" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="font-semibold text-[#17402a]">ปริมาณซื้อขายวัสดุ</h2>
          <p className="mb-4 text-xs text-slate-500">6 เดือนล่าสุด (ตัน) จากข้อตกลงที่ยืนยันแล้ว</p>
          <BarChart labels={chart.labels} values={chart.values} height={190} />
        </Card>
        <Card className="bg-[#e8f1e3]">
          <h2 className="font-semibold text-[#17402a]">ผลจับคู่ของคุณ</h2>
          <p className="mt-1 text-xs text-slate-600">คู่ค้าที่ระบบแนะนำจากประกาศของคุณ</p>
          <p className="mt-6 text-5xl font-bold text-[#17402a]">{matches.data?.length ?? 0} <span className="text-lg font-normal">คู่</span></p>
          <Link href="/factory/market" className="mt-6 inline-block text-sm text-[#1f6b43] underline">ดูตลาดวัสดุ →</Link>
        </Card>
      </div>
      <Card className="mt-4">
        <div className="mb-3 flex justify-between"><h2 className="font-semibold text-[#17402a]">ข้อตกลงล่าสุด</h2><Link href="/factory/orders" className="text-xs text-[#1f6b43]">ดูทั้งหมด →</Link></div>
        {latest.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">ยังไม่มีข้อตกลง</p> : (
          <table className="w-full"><thead><tr><th className={th}>รหัส</th><th className={th}>ปริมาณ</th><th className={th}>มูลค่า</th><th className={th}>สถานะ</th></tr></thead>
            <tbody>{latest.map((a) => (
              <tr key={a.id} className="border-t border-[#eef2ec]"><td className={td}><Link className="font-medium hover:underline" href={`/factory/orders/${a.id}`}>{agreementCode(a.id)}</Link></td>
                <td className={td}>{fmtNum(tonOf(a.qty_kg), 1)} ตัน</td><td className={td}>{fmtBaht(valueOf(a))}</td><td className={td}><Pill status={AGREEMENT_STATUS_TEXT[a.status]} /></td></tr>))}</tbody></table>)}
      </Card>
    </>
  );
}
