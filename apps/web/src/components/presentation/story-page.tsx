'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { FACTORY_HREF, FARMER_HREF, PITCH_SITE as T, SLIDES, SOURCES, TRANSPORT_TABLE, type Table } from '@/lib/pitch-content';

// three.js only runs in the browser, so the world loads client-side and never during server render.
const StoryWorld = dynamic(() => import('./story-world').then((m) => m.StoryWorld), { ssr: false });

function MiniTable({ t }: { t: Table }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white/90">
      <table className="w-full min-w-[22rem] text-left text-sm">
        <thead className="bg-emerald-50 text-emerald-900"><tr>{t.head.map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{t.rows.map((r) => <tr key={r[0]} className="border-t border-slate-100">{r.map((c, i) => <td key={i} className="px-3 py-1.5">{c}</td>)}</tr>)}</tbody>
        {t.foot ? <tfoot><tr className="border-t-2 border-emerald-200 bg-emerald-50 font-semibold text-emerald-900">{t.foot.map((c, i) => <td key={i} className="px-3 py-1.5">{c}</td>)}</tr></tfoot> : null}
      </table>
    </div>
  );
}

/** Scroll story: a fixed 3D world behind tall sections. Each section is one slide; scrolling moves the camera. */
export function StoryPage() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('[data-story]')];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(Number(e.target.getAttribute('data-story')));
    }, { rootMargin: '-45% 0px -45% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  const goTo = (i: number) => document.getElementById(`story-${i + 1}`)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="relative min-w-0 text-slate-900">
      <StoryWorld />
      <header className="fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-white/70 px-4 py-2 backdrop-blur">
        <a href="/start" className="text-lg font-bold text-emerald-800">AgriMatch</a>
        <p className="hidden text-xs text-amber-800 md:block">{T.status}</p>
        <div className="flex gap-2">
          <a href={FACTORY_HREF} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white">ลองต้นแบบ</a>
          <a href="/pitch" className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-700">แบบสไลด์</a>
        </div>
      </header>
      <nav aria-label="ไปยังตอน" className="fixed right-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 md:flex">
        {SLIDES.map((s, i) => (
          <button key={s.nav} type="button" onClick={() => goTo(i)} aria-current={i === active ? 'step' : undefined} title={s.nav}
            className={`h-3 w-3 rounded-full ring-2 ring-emerald-700 transition ${i === active ? 'scale-125 bg-emerald-700' : 'bg-white/80'}`}>
            <span className="sr-only">{i + 1} {s.nav}</span>
          </button>
        ))}
      </nav>

      <main>
        {SLIDES.map((s, i) => (
          <section key={s.title} id={`story-${i + 1}`} data-story={i} aria-labelledby={`story-title-${i + 1}`}
            className={`flex min-h-[115vh] items-center px-4 py-24 ${i % 2 ? 'md:justify-end' : 'md:justify-start'} md:px-12`}>
            <article className={`w-full max-w-xl space-y-3 rounded-3xl bg-white/85 p-6 shadow-xl backdrop-blur transition duration-700 ${i === active ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-40'}`}>
              <p className="text-sm font-medium text-emerald-700">ตอนที่ {i + 1}/{SLIDES.length} · {s.nav}</p>
              <h2 id={`story-title-${i + 1}`} className="text-3xl font-bold md:text-4xl">{s.title}</h2>
              {s.lead ? <p className="text-lg text-slate-700">{s.lead}</p> : null}
              {s.detail?.map((d) => <p key={d} className="text-base leading-relaxed text-slate-700">{d}</p>)}
              {s.items ? (
                <ul className="space-y-2">{s.items.map((p) => (
                  <li key={p.text} className="flex gap-3 rounded-xl bg-emerald-50/80 p-3"><span aria-hidden="true" className="text-2xl leading-none">{p.icon}</span>
                    <span className="text-sm text-slate-800">{p.title ? <b className="block">{p.title}</b> : null}{p.text}</span></li>
                ))}</ul>
              ) : null}
              {s.flow ? (
                <ol className="flex flex-wrap gap-2">{s.flow.map((f, k) => (
                  <li key={f.text} className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900">{k + 1}. {f.icon} {f.text}</li>
                ))}</ol>
              ) : null}
              {s.table ? <MiniTable t={s.table} /> : null}
              {s.formula ? <div className="space-y-1 rounded-xl bg-slate-900 p-3 font-mono text-xs text-emerald-200 md:text-sm">{s.formula.map((f) => <p key={f} className="break-words">{f}</p>)}</div> : null}
              {s.tableNote === '__transport__' ? <MiniTable t={TRANSPORT_TABLE} /> : null}
              {s.assume ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{s.assume}</p> : null}
              {s.warn ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠️ {s.warn}</p> : null}
              <details className="text-sm text-slate-600"><summary className="cursor-pointer font-medium text-emerald-800">บทพูด</summary><p className="mt-1">{s.say}</p></details>
              {i === SLIDES.length - 1 ? (
                <div className="space-y-2 pt-2">
                  <div className="flex flex-wrap gap-2">
                    <a href={FACTORY_HREF} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white">🏭 ลองใช้เว็บ (โรงงาน)</a>
                    <a href={FARMER_HREF} className="rounded-lg bg-white px-4 py-2 font-semibold text-emerald-800 ring-2 ring-emerald-700">🌾 เกษตรกร (LINE)</a>
                  </div>
                  <p className="text-xs text-slate-500">แหล่งอ้างอิง: {SOURCES.join(' · ')}</p>
                </div>
              ) : null}
            </article>
          </section>
        ))}
      </main>
      {active === 0 ? <p aria-hidden="true" className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2 animate-bounce rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-emerald-800 shadow">เลื่อนลงเพื่อเล่าเรื่องต่อ ↓</p> : null}
    </div>
  );
}
