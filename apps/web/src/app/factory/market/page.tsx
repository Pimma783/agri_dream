import { Card, GREEN, PageHead, Thumb } from '@/components/factory/ui';
import { MATERIALS, baht } from '@/lib/factory-mock';

const TYPES = ['แกลบ', 'ฟางข้าว', 'ซังข้าวโพด', 'กะลาปาล์ม', 'เศษไม้', 'ชานอ้อย'];

export default function MarketPage() {
  return (
    <>
      <PageHead title="ตลาดวัสดุการเกษตร" sub="ค้นหาวัสดุที่ใช่ เชื่อมต่อผู้ขายโดยตรง เพื่อโอกาสให้ธุรกิจ"
        action={<div className="flex gap-2"><button className="rounded-lg border border-[#e5eae3] bg-white px-4 py-2 text-sm">+ ประกาศรับซื้อ</button><button className={`rounded-lg px-4 py-2 text-sm ${GREEN}`}>+ ลงขายวัสดุ</button></div>} />
      <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-[#e5eae3] bg-white p-3">
        <input aria-label="ค้นหา" placeholder="ค้นหาวัสดุ เช่น แกลบ ฟางข้าว ซังข้าวโพด" className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none" />
        <select aria-label="จังหวัด" className="rounded-lg border border-[#e5eae3] px-3 py-2 text-sm"><option>ทุกจังหวัด</option></select>
        <button className={`rounded-lg px-5 py-2 text-sm ${GREEN}`}>ค้นหา</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <Card className="h-fit">
          <h2 className="font-semibold text-[#17402a]">ตัวกรอง</h2>
          <p className="mt-4 text-xs font-medium">ประเภทวัสดุ</p>
          {TYPES.map((t) => <label key={t} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={t === 'แกลบ'} />{t}</label>)}
          <p className="mt-4 text-xs font-medium">ราคา / ตัน</p>
          <div className="mt-2 flex items-center gap-1 text-sm"><input aria-label="ราคาต่ำสุด" placeholder="฿0" className="w-full rounded border px-2 py-1" />-<input aria-label="ราคาสูงสุด" placeholder="฿5,000" className="w-full rounded border px-2 py-1" /></div>
          <p className="mt-4 text-xs font-medium">ความชื้น</p>
          <select aria-label="ความชื้น" className="mt-2 w-full rounded border px-2 py-1 text-sm"><option>ทุกระดับความชื้น</option></select>
        </Card>
        <div>
          <p className="mb-3 text-sm text-slate-500">วัสดุทั้งหมด · {MATERIALS.length} รายการ</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {MATERIALS.map((m) => (
              <article key={m.id} className="overflow-hidden rounded-xl border border-[#e5eae3] bg-white">
                <Thumb tone={m.tone} className="h-32" />
                <div className="p-3">
                  <h3 className="font-semibold text-[#17402a]">{m.name}</h3>
                  <p className="text-xs text-slate-500">{m.seller} · {m.province}</p>
                  <p className="text-xs text-slate-400">คงเหลือ {m.qty} ตัน · ความชื้น ≤ {m.moisture}%</p>
                  <div className="mt-3 flex items-center justify-between"><b>{baht(m.price)} <span className="text-xs font-normal text-slate-400">/ ตัน</span></b><button className={`rounded px-3 py-1 text-xs ${GREEN}`}>ดูรายละเอียด</button></div>
                </div>
              </article>))}
          </div>
        </div>
      </div>
    </>
  );
}
