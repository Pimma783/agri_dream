import { Card, GREEN, PageHead, Pill, Stat, td, th } from '@/components/factory/ui';
import { ORDERS } from '@/lib/factory-mock';

const STEPS = ['รับคำสั่งซื้อ', 'เตรียมสินค้า', 'ระหว่างขนส่ง', 'ถึงปลายทาง'];

export default function ShippingPage() {
  return (
    <>
      <PageHead title="การจัดส่ง" sub="ติดตามการขนส่งวัสดุระหว่างแหล่งผลิตถึงโรงงาน" action={<button className={`rounded-lg px-4 py-2 text-sm ${GREEN}`}>ส่งออกข้อมูล</button>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="การจัดส่งทั้งหมด" value="24" unit="รายการ" /><Stat label="รอยืนยัน" value="4" /><Stat label="ระหว่างทาง" value="6" /><Stat label="จัดส่งสำเร็จ" value="14" />
      </div>
      <Card className="mt-4">
        <h2 className="mb-2 font-semibold text-[#17402a]">รายการจัดส่ง</h2>
        <table className="w-full"><thead><tr><th className={th}>เลขจัดส่ง</th><th className={th}>วัสดุ</th><th className={th}>เส้นทาง</th><th className={th}>วันที่</th><th className={th}>สถานะ</th></tr></thead>
          <tbody>{ORDERS.map((o) => <tr key={o.id} className="border-t border-[#eef2ec]"><td className={td}>{o.code}</td><td className={td}>{o.material}</td><td className={td}>{o.from} → นครปฐม</td><td className={td}>{o.date}</td><td className={td}><Pill status={o.status} /></td></tr>)}</tbody></table>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold text-[#17402a]">ติดตามการจัดส่ง SHP-6911-024</h2>
        <p className="mb-5 text-sm text-slate-500">คาดว่าจะถึงวันนี้ 14:30 น. · โทร 081-234-5678</p>
        <ol className="grid grid-cols-4 gap-2">{STEPS.map((s, i) => <li key={s} className="text-xs"><div className={`mb-2 h-1.5 rounded ${i < 3 ? 'bg-[#1f6b43]' : 'bg-slate-200'}`} />{s}</li>)}</ol>
      </Card>
    </>
  );
}
