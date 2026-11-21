import type { ReactNode } from 'react';

/** Mobile-first replacement for wide tables: one card per row, no horizontal scroll at 360 px. */
export function CardList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="space-y-3">
      {children}
    </ul>
  );
}

export function Card({ title, badge, children }: { title: ReactNode; badge?: ReactNode; children?: ReactNode }) {
  return (
    <li className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-base font-semibold">{title}</h3>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      {children ? <div className="mt-2 space-y-2 break-words text-sm text-slate-700">{children}</div> : null}
    </li>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-4 text-xl font-semibold">{children}</h1>;
}

/** Touch-friendly button class (min 44 px). Use on <button> and <a>. */
export const BUTTON_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-emerald-700 px-4 text-base font-medium text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50';
