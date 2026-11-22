import Link from 'next/link';
import { LogoutLink } from '@/components/factory/logout-link';
import { Card, PageHead } from '@/components/factory/ui';

const LINKS = [
  { href: '/factory/shipping', icon: '⛟', label: 'การจัดส่ง', hint: 'ติดตามการขนส่ง (ตัวอย่าง)' },
  { href: '/factory/reports', icon: '▥', label: 'รายงาน', hint: 'สรุปการซื้อและมูลค่า' },
  { href: '/factory/settings', icon: '⚙', label: 'ตั้งค่าโรงงาน', hint: 'ข้อมูลบริษัทและการแจ้งเตือน' },
  { href: '/factory/help', icon: 'ⓘ', label: 'ศูนย์ช่วยเหลือ', hint: 'คำถามที่พบบ่อย' },
  { href: '/settings/line', icon: '💬', label: 'เชื่อมต่อ LINE', hint: 'รับแจ้งเตือนผ่าน LINE' },
];

/** Mobile menu: the pages that do not fit in the bottom tab bar. */
export default function MorePage() {
  return (
    <>
      <PageHead title="เพิ่มเติม" />
      <Card className="divide-y divide-[#eef2ec] !p-0">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-3 px-4 py-4">
            <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-[#e8f1e3] text-[#1f6b43]">{l.icon}</span>
            <span className="flex-1"><b className="block text-sm text-slate-800">{l.label}</b><span className="text-xs text-slate-500">{l.hint}</span></span>
            <span aria-hidden="true" className="text-slate-400">›</span>
          </Link>
        ))}
        <LogoutLink className="flex w-full items-center gap-3 px-4 py-4 text-left text-sm text-slate-600"><span aria-hidden="true" className="w-9 text-center">⇥</span>ออกจากระบบ</LogoutLink>
      </Card>
    </>
  );
}
