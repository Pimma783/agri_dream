import { BarChart, Card, GREEN, PageHead, Stat, td, th } from '@/components/factory/ui';
import { MONTHLY, MONTHS } from '@/lib/factory-mock';

const ROWS = [['แกลบแห้ง', 12, 70, 105000, '35.0%'], ['กะลาปาล์ม', 7, 50, 140000, '46.7%'], ['เศษไม้สับ', 5, 30, 55000, '18.3%']] as const;

export default function ReportsPage() {
  return (
    <>
      <PageHead title="รายงาน" sub="สรุปการซื้อวัสดุและข้อมูลเชิงวิเคราะห์ธุรกิจของคุณ" action={<button className={`rounded-lg px-4 py-2 text-sm ${GREEN}`}>ดาวน์โหลดรายงาน</button>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="มูลค่าซื้อรวม" value="฿300,000" note="+9.1% จากเดือนก่อน" /><Stat label="ปริมาณวัสดุที่ซื้อ" value="150" unit="ตัน" /><Stat label="คำสั่งซื้อทั้งหมด" value="24" unit="รายการ" /><Stat label="ผู้ขายที่ซื้อด้วย" value="8" unit="ราย" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><h2 className="font-semibold text-[#17402a]">แนวโน้มมูลค่าการซื้อ</h2><p className="mb-4 text-xs text-slate-500">หน่วย: พันบาท</p><BarChart labels={MONTHS} values={MONTHLY} height={190} /></Card>
        <Card><h2 className="mb-4 font-semibold text-[#17402a]">สัดส่วนมูลค่าตามวัสดุ</h2>
          {ROWS.map((r) => <div key={r[0]} className="mb-4 text-sm"><div className="flex justify-between"><span>{r[0]}</span><b>{r[4]}</b></div><div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-full rounded bg-[#1f6b43]" style={{ width: r[4] }} /></div></div>)}</Card>
      </div>
      <Card className="mt-4"><h2 className="mb-2 font-semibold text-[#17402a]">สรุปการซื้อแยกตามวัสดุ</h2>
        <table className="w-full"><thead><tr><th className={th}>ประเภทวัสดุ</th><th className={th}>คำสั่งซื้อ</th><th className={th}>ปริมาณ (ตัน)</th><th className={th}>มูลค่า (บาท)</th><th className={th}>สัดส่วน</th></tr></thead>
          <tbody>{ROWS.map((r) => <tr key={r[0]} className="border-t border-[#eef2ec]"><td className={td}>{r[0]}</td><td className={td}>{r[1]}</td><td className={td}>{r[2]}</td><td className={td}>{r[3].toLocaleString()}</td><td className={td}>{r[4]}</td></tr>)}
            <tr className="border-t bg-[#eef4ea] font-semibold"><td className={td}>รวมทั้งหมด</td><td className={td}>24</td><td className={td}>150</td><td className={td}>300,000</td><td className={td}>100%</td></tr></tbody></table></Card>
    </>
  );
}
