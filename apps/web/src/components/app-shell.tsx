import type { ReactNode } from 'react';
import type { MeResponse } from '@agrimatch/contracts';
import { navForRole, ROLE_LABEL_TH } from '@/lib/nav';
import { BottomNav } from './bottom-nav';

/** Compact top bar (org and role) plus bottom navigation. Content stays within 360 px. */
export function AppShell({ me, children }: { me: Pick<MeResponse, 'org_name' | 'role'>; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex min-h-12 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <span className="shrink-0 font-semibold text-emerald-800">Agrimatch</span>
        <span className="min-w-0 truncate text-sm text-slate-600" data-testid="org-line">
          {me.org_name} · {ROLE_LABEL_TH[me.role]}
        </span>
      </header>
      <main className="mx-auto w-full max-w-3xl min-w-0 flex-1 px-4 pb-24 pt-4 sm:pb-6">{children}</main>
      <BottomNav items={navForRole(me.role)} />
    </div>
  );
}
