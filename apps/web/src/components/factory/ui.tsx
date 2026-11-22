import type { ReactNode } from 'react';

export const GREEN = 'bg-[#1f6b43] text-white hover:bg-[#185736]';

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-[#17402a]">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-slate-500">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[#e5eae3] bg-white p-5 ${className}`}>{children}</section>;
}

export function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <Card>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-[#17402a]">
        {value} {unit ? <span className="text-sm font-normal text-slate-500">{unit}</span> : null}
      </p>
      {note ? <p className="mt-1 text-xs text-emerald-700">{note}</p> : null}
    </Card>
  );
}

const PILL: Record<string, string> = {
  กำลังจัดส่ง: 'bg-sky-100 text-sky-800', รอยืนยัน: 'bg-amber-100 text-amber-800', สำเร็จ: 'bg-emerald-100 text-emerald-800',
};
export function Pill({ status }: { status: string }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${PILL[status] ?? 'bg-slate-100 text-slate-700'}`}>{status}</span>;
}

export function Thumb({ tone, className = '' }: { tone: string; className?: string }) {
  return <div aria-hidden="true" className={`bg-gradient-to-br ${tone} ${className}`} />;
}

export function BarChart({ labels, values, height = 160 }: { labels: string[]; values: number[]; height?: number }) {
  const max = Math.max(...values);
  return (
    <div className="flex items-end gap-4" style={{ height }} role="img" aria-label="แผนภูมิแท่ง">
      {values.map((v, i) => (
        <div key={labels[i]} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height: '100%' }}>
          <span className="text-[11px] text-slate-500">{v}</span>
          <div className={`w-full max-w-10 rounded-t ${i === values.length - 1 ? 'bg-[#1f6b43]' : 'bg-[#b7cfb9]'}`} style={{ height: `${(v / max) * (height - 40)}px` }} />
          <span className="text-[11px] text-slate-500">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export const th = 'px-3 py-2 text-left text-xs font-medium text-slate-500';
export const td = 'px-3 py-3 text-sm';
