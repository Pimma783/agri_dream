'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/nav';
import { isActive } from '@/lib/nav';

/** Bottom navigation for mobile; the same items render in the top bar from `sm` up. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? '/';
  return (
    <nav aria-label="เมนูหลัก" className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white sm:static sm:border-0">
      <ul className="mx-auto flex max-w-3xl">
        {items.map((item) => {
          const active = isActive(item.href, pathname);
          const base = 'flex min-h-14 min-w-11 flex-col items-center justify-center gap-0.5 px-1 text-xs';
          return (
            <li key={item.href} className="min-w-0 flex-1">
              {item.ready ? (
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`${base} ${active ? 'font-semibold text-emerald-800' : 'text-slate-600'}`}
                >
                  <span aria-hidden="true" className="text-xl leading-none">{item.icon}</span>
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              ) : (
                <span aria-disabled="true" className={`${base} text-slate-400`}>
                  <span aria-hidden="true" className="text-xl leading-none">{item.icon}</span>
                  <span className="max-w-full truncate">{item.label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
