import type { Role } from '@agrimatch/contracts';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** False until the page exists; the item is shown disabled so it never looks usable. */
  ready: boolean;
}

const HOME: NavItem = { href: '/', label: 'หน้าหลัก', icon: '🏠', ready: true };

const SETTINGS: NavItem = { href: '/settings/line', label: 'ตั้งค่า', icon: '⚙', ready: true };
const ROLE_NAV: Record<Role, NavItem[]> = {
  FARMER: [
    HOME,
    { href: '/listings', label: 'ประกาศขาย', icon: '🌾', ready: false },
    { href: '/offers', label: 'ข้อเสนอ', icon: '✉️', ready: true },
    { href: '/agreements', label: 'ข้อตกลง', icon: '🤝', ready: true },
    SETTINGS,
  ],
  FACTORY: [
    HOME,
    { href: '/demands', label: 'ความต้องการ', icon: '🏭', ready: true },
    { href: '/matches', label: 'ผลจับคู่', icon: '🔗', ready: true },
    { href: '/offers', label: 'ข้อเสนอ', icon: '✉️', ready: true },
    { href: '/agreements', label: 'ข้อตกลง', icon: '🤝', ready: true },
    SETTINGS,
  ],
  BALER: [
    HOME,
    { href: '/demands', label: 'รับซื้อ', icon: '🏭', ready: true },
    { href: '/services', label: 'รับจ้างอัด', icon: '🚜', ready: true },
    { href: '/matches', label: 'ผลจับคู่', icon: '🔗', ready: true },
    { href: '/offers', label: 'ข้อเสนอ', icon: '✉️', ready: true },
    { href: '/agreements', label: 'ข้อตกลง', icon: '🤝', ready: true },
    { href: '/resale', label: 'ขายต่อ', icon: '♻️', ready: true },
    SETTINGS,
  ],
};

export function navForRole(role: Role): NavItem[] {
  return ROLE_NAV[role];
}

export const ROLE_LABEL_TH: Record<Role, string> = {
  FARMER: 'เกษตรกร',
  BALER: 'ผู้อัดฟาง',
  FACTORY: 'โรงงาน',
};

export function isActive(itemHref: string, pathname: string): boolean {
  return itemHref === '/' ? pathname === '/' : pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}
