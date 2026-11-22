import { DemoNotice, PageHead } from '@/components/factory/ui';
import { THREADS } from '@/lib/factory-mock';

export default function MessagesPage() {
  return (
    <>
      <PageHead title="ข้อความ" sub="สนทนากับผู้ขายและผู้อัดฟาง" />
      <DemoNotice>ระบบยังไม่มีแชทระหว่างคู่ค้าในเวอร์ชันนี้ (ไม่เปิดเผยข้อมูลติดต่อจนกว่าจะมีข้อตกลง)</DemoNotice>
      <div className="grid min-h-[480px] overflow-hidden rounded-xl border border-[#e5eae3] bg-white md:grid-cols-[280px_1fr]">
        <ul className="border-r border-[#e5eae3]">
          {THREADS.map((t, i) => (
            <li key={t.id} className={`flex gap-3 border-b border-[#eef2ec] p-3 ${i === 0 ? 'bg-[#e8f1e3]' : ''}`}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200">👤</span>
              <div className="min-w-0 flex-1"><p className="flex justify-between text-sm font-semibold text-[#17402a]">{t.name}<span className="text-[10px] font-normal text-slate-400">{t.time}</span></p><p className="truncate text-xs text-slate-500">{t.last}</p></div>
              {t.unread ? <span className="h-fit rounded-full bg-[#1f6b43] px-1.5 text-[10px] text-white">{t.unread}</span> : null}
            </li>))}
        </ul>
        <div className="hidden flex-col p-4 md:flex">
          <p className="border-b pb-3 font-semibold text-[#17402a]">โรงสีรุ่งเรือง</p>
          <div className="flex flex-1 flex-col justify-end gap-2 py-4 text-sm">
            <p className="max-w-xs rounded-xl bg-slate-100 p-3">ส่งรูปแกลบล็อตล่าสุดให้แล้วครับ</p>
            <p className="max-w-xs self-end rounded-xl bg-[#1f6b43] p-3 text-white">ขอบคุณครับ ขอดูผลความชื้นด้วย</p>
          </div>
          <form className="flex gap-2"><input aria-label="พิมพ์ข้อความ" placeholder="พิมพ์ข้อความ…" className="flex-1 rounded-lg border border-[#e5eae3] px-3 py-2 text-sm" /><button type="button" className="rounded-lg bg-[#1f6b43] px-4 text-sm text-white">ส่ง</button></form>
        </div>
      </div>
    </>
  );
}
