import type { Metadata } from 'next';
import Link from 'next/link';

// Public entry: pick the prototype (the working app) or the presentation (the pitch). No session needed.
export const metadata: Metadata = {
  title: 'AgriMatch · เลือกโหมด',
  description: 'เลือกว่าจะลองใช้ต้นแบบ หรือดูการนำเสนอโครงการ',
  robots: { index: false, follow: false },
};

const CARDS = [
  {
    href: '/login', icon: '📱', title: 'ต้นแบบ', en: 'Prototype',
    text: 'เข้าไปลองใช้แอปจริง ลงขาย ดูผลจับคู่ ส่งข้อเสนอ และดูข้อตกลง',
    cta: 'เข้าสู่ต้นแบบ', tone: 'bg-emerald-700 text-white hover:bg-emerald-800',
  },
  {
    href: '/story', icon: '🎤', title: 'นำเสนอ', en: 'Presentation',
    text: 'เลื่อนลงเพื่อเล่าเรื่องในโลก 3D 9 ตอน กล้องเปลี่ยนมุมตามเนื้อหา (มีแบบสไลด์พร้อมกรอบมือถือด้วย)',
    cta: 'เปิดการนำเสนอ', tone: 'border-2 border-emerald-700 bg-white text-emerald-800 hover:bg-emerald-50',
  },
] as const;

export default function StartPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl min-w-0 flex-col justify-center gap-6 px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold text-emerald-800">AgriMatch</h1>
        <p className="mt-1 text-lg text-slate-700">จะเอาแบบไหนดี <span className="text-sm text-slate-500">/ Which one?</span></p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <li key={c.href} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
            <span aria-hidden="true" className="text-4xl">{c.icon}</span>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{c.title} <span className="text-sm font-normal text-slate-500">{c.en}</span></h2>
            <p className="mt-1 flex-1 text-base text-slate-700">{c.text}</p>
            <Link href={c.href} className={`mt-4 inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-base font-semibold ${c.tone}`}>{c.cta}</Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-500">อยากดูแบบสไลด์? <Link href="/pitch" className="underline">เปิดแบบสไลด์</Link> · ต้องการบัญชีสำหรับกรรมการ? ดูที่ <Link href="/presentation" className="underline">หน้าสำหรับกรรมการ</Link></p>
    </main>
  );
}
