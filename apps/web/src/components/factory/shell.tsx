'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { LogoutLink } from './logout-link';

const NAV = [
  { href: '/factory', label: 'ภาพรวม', icon: '▦' },
  { href: '/factory/market', label: 'ตลาดวัสดุ', icon: '▤' },
  { href: '/factory/orders', label: 'คำสั่งซื้อขาย', icon: '☰' },
  { href: '/factory/shipping', label: 'การจัดส่ง', icon: '⛟' },
  { href: '/factory/reports', label: 'รายงาน', icon: '▥' },
  { href: '/factory/messages', label: 'ข้อความ', icon: '✉' },
  { href: '/factory/settings', label: 'ตั้งค่าโรงงาน', icon: '⚙' },
];
const TABS = [
  { href: '/factory', label: 'ภาพรวม', icon: '▦' },
  { href: '/factory/market', label: 'ตลาด', icon: '▤' },
  { href: '/factory/orders', label: 'คำสั่งซื้อ', icon: '☰' },
  { href: '/factory/messages', label: 'ข้อความ', icon: '✉' },
  { href: '/factory/more', label: 'เพิ่มเติม', icon: '≡' },
];
const MORE_PAGES = ['/factory/shipping', '/factory/reports', '/factory/settings', '/factory/help'];
const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.href, n.label]));
TITLES['/factory/help'] = 'ศูนย์ช่วยเหลือ';
TITLES['/factory/more'] = 'เพิ่มเติม';

export function FactoryShell({ orgName, children }: { orgName: string; children: ReactNode }) {
  const path = usePathname() ?? '/factory';
  const on = (h: string) => (h === '/factory' ? path === h : path.startsWith(h));
  const onTab = (h: string) => (h === '/factory/more' ? path === h || MORE_PAGES.some((m) => path.startsWith(m)) : on(h));
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
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-xl bg-[#e8f1e3] p-3 text-xs text-[#17402a]">
            <p className="font-semibold">เดินไปด้วยกัน</p>
            <p className="mt-1 text-slate-600">เปลี่ยนวัสดุเหลือใช้ให้เป็นโอกาสของธุรกิจ</p>
          </div>
          <Link href="/factory/help" className="block px-3 py-1 text-sm text-slate-600">ⓘ ศูนย์ช่วยเหลือ</Link>
          <LogoutLink className="block px-3 py-1 text-left text-sm text-slate-600">⇥ ออกจากระบบ</LogoutLink>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-[#e5eae3] bg-white px-4 py-3 text-xs text-slate-500 md:static md:px-6">
          <Link href="/factory" className="text-xl font-bold text-[#1f6b43] md:hidden">Agrimatch</Link>
          <p className="hidden md:block">พื้นที่ทำงาน <span className="mx-1">/</span> <b className="text-slate-800">{TITLES[current ?? ''] ?? ''}</b></p>
          <div className="flex items-center gap-4">
            <span aria-label="การแจ้งเตือน">🔔</span>
            <span className="flex min-w-0 items-center gap-2 rounded-lg bg-[#f3f6f1] px-2 py-1.5 md:px-3">
              <span className="grid h-7 w-7 place-items-center rounded bg-[#dcebdc] text-[#1f6b43]">▥</span>
              <span><span className="min-w-0"><b className="block max-w-[9rem] truncate text-slate-800 md:max-w-none">{orgName}</b><span className="hidden md:inline">บัญชีโรงงานรับซื้อ</span></span></span>
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 pb-24 md:p-6 md:pb-6">{children}</main>
        <nav aria-label="เมนูมือถือ" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[#e5eae3] bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          {TABS.map((n) => (
            <Link key={n.href} href={n.href} aria-current={onTab(n.href) ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${onTab(n.href) ? 'font-semibold text-[#1f6b43]' : 'text-slate-500'}`}>
              <span aria-hidden="true" className="text-lg leading-none">{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
