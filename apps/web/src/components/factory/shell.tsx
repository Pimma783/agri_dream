'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/factory', label: 'ภาพรวม', icon: '▦' },
  { href: '/factory/market', label: 'ตลาดวัสดุ', icon: '▤' },
  { href: '/factory/orders', label: 'คำสั่งซื้อขาย', icon: '☰' },
  { href: '/factory/shipping', label: 'การจัดส่ง', icon: '⛟' },
  { href: '/factory/reports', label: 'รายงาน', icon: '▥' },
  { href: '/factory/messages', label: 'ข้อความ', icon: '✉', badge: 3 },
  { href: '/factory/settings', label: 'ตั้งค่าโรงงาน', icon: '⚙' },
];
const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.href, n.label]));
TITLES['/factory/help'] = 'ศูนย์ช่วยเหลือ';

export function FactoryShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '/factory';
  const on = (h: string) => (h === '/factory' ? path === h : path.startsWith(h));
  const current = Object.keys(TITLES).filter(on).sort((a, b) => b.length - a.length)[0];
  return (
    <div className="flex min-h-screen bg-[#fbfaf5] text-slate-800">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[#e5eae3] bg-white p-4 md:flex">
        <Link href="/factory" className="px-2 pb-6 text-2xl font-bold text-[#1f6b43]">Agrimatch
          <span className="block text-[9px] font-normal tracking-widest text-slate-400">AGRIMATCH RECIRCULATED</span>
        </Link>
        <p className="px-2 pb-1 text-[11px] text-slate-400">พื้นที่ทำงาน</p>
        <nav aria-label="เมนูโรงงาน" className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={on(n.href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${on(n.href) ? 'bg-[#dcebdc] font-semibold text-[#17402a]' : 'text-slate-600 hover:bg-slate-50'}`}>
              <span aria-hidden="true" className="w-4 text-center">{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {n.badge ? <span className="rounded-full bg-[#dcebdc] px-1.5 text-[10px]">{n.badge}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-xl bg-[#e8f1e3] p-3 text-xs text-[#17402a]">
            <p className="font-semibold">เดินไปด้วยกัน</p>
            <p className="mt-1 text-slate-600">เปลี่ยนวัสดุเหลือใช้ให้เป็นโอกาสของธุรกิจ</p>
          </div>
          <Link href="/factory/help" className="block px-3 py-1 text-sm text-slate-600">ⓘ ศูนย์ช่วยเหลือ</Link>
          <Link href="/login" className="block px-3 py-1 text-sm text-slate-600">⇥ ออกจากระบบ</Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-[#e5eae3] bg-white px-6 py-3 text-xs text-slate-500">
          <p>พื้นที่ทำงาน <span className="mx-1">/</span> <b className="text-slate-800">{TITLES[current ?? ''] ?? ''}</b></p>
          <div className="flex items-center gap-4">
            <span aria-label="การแจ้งเตือน">🔔</span>
            <span className="flex items-center gap-2 rounded-lg bg-[#f3f6f1] px-3 py-1.5">
              <span className="grid h-7 w-7 place-items-center rounded bg-[#dcebdc] text-[#1f6b43]">▥</span>
              <span><b className="block text-slate-800">บริษัท กรีนเอ็นเนอร์จี จำกัด</b>บัญชีโรงงานรับซื้อ</span>
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
        <nav aria-label="เมนูมือถือ" className="sticky bottom-0 flex overflow-x-auto border-t bg-white md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`flex-1 whitespace-nowrap px-3 py-3 text-center text-xs ${on(n.href) ? 'font-semibold text-[#1f6b43]' : 'text-slate-500'}`}>{n.label}</Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
