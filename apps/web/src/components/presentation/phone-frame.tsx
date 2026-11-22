'use client';
import { useEffect, useState } from 'react';
import { FACTORY_HREF, FARMER_HREF, PHONE_SCREENS } from '@/lib/pitch-content';

const QUICK = [
  { label: '🏭 โรงงาน', href: FACTORY_HREF },
  { label: '🌾 เกษตรกร', href: FARMER_HREF },
  { label: '📊 พอร์ทัล', href: '/factory' },
] as const;

/** A phone-shaped frame around the real app (same origin). It follows the slide; the buttons override it until the next slide. */
export function PhoneFrame({ slide }: { slide: number }) {
  const auto = PHONE_SCREENS[slide] ?? PHONE_SCREENS[0]!;
  const [override, setOverride] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => { setOverride(null); }, [slide]);
  const src = override ?? auto.href;
  return (
    <aside aria-label="ลองใช้งานในกรอบมือถือ" data-testid="phone-frame" className="flex flex-col items-center gap-3">
      <div role="group" aria-label="เลือกหน้าที่จะลอง" className="flex flex-wrap justify-center gap-1">
        {QUICK.map((q) => (
          <button key={q.href} type="button" aria-pressed={src === q.href} onClick={() => { setOverride(q.href); setNonce((n) => n + 1); }}
            className={`min-h-9 rounded-full px-3 text-sm font-medium ${src === q.href ? 'bg-emerald-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}>{q.label}</button>
        ))}
      </div>
      <p data-testid="phone-caption" className="text-sm font-medium text-emerald-900">{override ? 'เลือกเอง' : auto.label}</p>
      <div className="relative rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 shadow-xl">
        <span aria-hidden="true" className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-slate-900" />
        <iframe key={`${src}-${nonce}`} title="Agrimatch บนมือถือ" src={src} data-testid="phone-iframe"
          className="block h-[clamp(440px,calc(100vh-19rem),640px)] w-[320px] rounded-[1.8rem] bg-white" />
      </div>
      <p className="max-w-[20rem] text-center text-xs text-slate-500">กดใช้งานได้จริงในกรอบนี้ ล็อกอินด้วยบัญชีทดลอง (ขอจากทีมงาน)</p>
      <button type="button" onClick={() => { setOverride(null); setNonce((n) => n + 1); }} className="text-xs font-medium text-emerald-800 underline">กลับไปหน้าของสไลด์นี้</button>
    </aside>
  );
}
