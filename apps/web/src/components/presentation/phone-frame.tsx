'use client';
import { useState } from 'react';
import { FACTORY_HREF, FARMER_HREF } from '@/lib/pitch-content';

const SCREENS = [
  { key: 'factory', label: '🏭 โรงงาน', href: FACTORY_HREF },
  { key: 'farmer', label: '🌾 เกษตรกร', href: FARMER_HREF },
  { key: 'portal', label: '📊 พอร์ทัล', href: '/factory' },
] as const;

/** A phone-shaped frame around the real app (same origin), so the audience can tap through it on the slide page. */
export function PhoneFrame() {
  const [screen, setScreen] = useState<(typeof SCREENS)[number]>(SCREENS[0]);
  const [nonce, setNonce] = useState(0);
  return (
    <aside aria-label="ลองใช้งานในกรอบมือถือ" data-testid="phone-frame" className="flex flex-col items-center gap-3">
      <div role="group" aria-label="เลือกหน้าที่จะลอง" className="flex flex-wrap justify-center gap-1">
        {SCREENS.map((s) => (
          <button key={s.key} type="button" aria-pressed={s.key === screen.key} onClick={() => { setScreen(s); setNonce((n) => n + 1); }}
            className={`min-h-9 rounded-full px-3 text-sm font-medium ${s.key === screen.key ? 'bg-emerald-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}>{s.label}</button>
        ))}
      </div>
      <div className="relative rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 shadow-xl">
        <span aria-hidden="true" className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-slate-900" />
        <iframe key={`${screen.key}-${nonce}`} title="Agrimatch บนมือถือ" src={screen.href}
          className="block h-[clamp(460px,calc(100vh-18rem),640px)] w-[320px] rounded-[1.8rem] bg-white" />
      </div>
      <p className="max-w-[20rem] text-center text-xs text-slate-500">กดใช้งานได้จริงในกรอบนี้ ล็อกอินด้วยบัญชีทดลอง (ขอจากทีมงาน)</p>
      <button type="button" onClick={() => setNonce((n) => n + 1)} className="text-xs font-medium text-emerald-800 underline">เริ่มหน้านี้ใหม่</button>
    </aside>
  );
}
