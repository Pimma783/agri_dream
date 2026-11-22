'use client';
import { useEffect, useState } from 'react';
import { FACTORY_HREF, FARMER_HREF, PHONE_SCREENS } from '@/lib/pitch-content';

// iPhone Pro Max class screen in CSS pixels (iPhone 17 Pro Max: 440 x 956). The frame scales down to fit the window height.
export const PHONE_W = 440;
export const PHONE_H = 956;
const BEZEL = 10;

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
  const [scale, setScale] = useState(0.7);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, Math.max(0.4, (window.innerHeight - 300) / (PHONE_H + BEZEL * 2))));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
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
      <div style={{ width: (PHONE_W + BEZEL * 2) * scale, height: (PHONE_H + BEZEL * 2) * scale }} data-testid="phone-box">
        <div className="relative origin-top-left rounded-[3rem] border-slate-900 bg-slate-900 shadow-xl"
          style={{ width: PHONE_W + BEZEL * 2, height: PHONE_H + BEZEL * 2, padding: BEZEL, transform: `scale(${scale})` }}>
          <span aria-hidden="true" className="absolute left-1/2 top-3 z-10 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />
          <iframe key={`${src}-${nonce}`} title="Agrimatch บนมือถือ" src={src} data-testid="phone-iframe"
            className="block rounded-[2.4rem] bg-white" style={{ width: PHONE_W, height: PHONE_H }} />
        </div>
      </div>
      <p className="max-w-[24rem] text-center text-xs text-slate-500">กดใช้งานได้จริงในกรอบนี้ ขนาดเท่า iPhone Pro Max (440×956) ล็อกอินด้วยบัญชีทดลอง (ขอจากทีมงาน)</p>
      <button type="button" onClick={() => { setOverride(null); setNonce((n) => n + 1); }} className="text-xs font-medium text-emerald-800 underline">กลับไปหน้าของสไลด์นี้</button>
    </aside>
  );
}
