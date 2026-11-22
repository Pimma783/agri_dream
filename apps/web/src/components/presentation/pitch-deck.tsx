'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneFrame } from './phone-frame';
import {
  DEMO_HREF, FACTORY_HREF, FARMER_HREF, PITCH_COUNT, PITCH_SITE as T, SLIDES, SOURCES, TRANSPORT_TABLE, type Table,
} from '@/lib/pitch-content';

const BTN =
  'inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-40';

function DataTable({ t, testId }: { t: Table; testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white" data-testid={testId}>
      <table className="w-full min-w-[28rem] text-left text-sm md:text-base">
        <thead className="bg-emerald-50 text-emerald-900"><tr>{t.head.map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{t.rows.map((r) => <tr key={r[0]} className="border-t border-slate-100">{r.map((c, i) => <td key={i} className={`px-3 py-2 ${i === 0 ? 'font-medium' : ''}`}>{c}</td>)}</tr>)}</tbody>
        {t.foot ? <tfoot><tr className="border-t-2 border-emerald-200 bg-emerald-50 font-semibold text-emerald-900">{t.foot.map((c, i) => <td key={i} className="px-3 py-2">{c}</td>)}</tr></tfoot> : null}
      </table>
    </div>
  );
}

export function PitchDeck({ slide: initial }: { slide: number }) {
  const [slide, setSlide] = useState(Math.min(Math.max(initial, 0), PITCH_COUNT - 1));
  const [notes, setNotes] = useState(false);
  const refs = useRef<(HTMLElement | null)[]>([]);

  const go = useCallback((to: number) => {
    const n = Math.min(Math.max(to, 0), PITCH_COUNT - 1);
    setSlide(n);
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches) {
      refs.current[n]?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (e.altKey || e.ctrlKey || e.metaKey || (el instanceof Element && el.closest('input, textarea, select'))) return;
      if (e.key === 'ArrowRight') go(slide + 1);
      else if (e.key === 'ArrowLeft') go(slide - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, slide]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('s', String(slide + 1));
    window.history.replaceState(null, '', url);
  }, [slide]);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-4 px-4 py-4 md:min-h-screen">
      <header className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-2">
        <p className="text-xl font-semibold text-emerald-800">AgriMatch</p>
        <nav aria-label={T.navLabel} className="order-last flex w-full items-center gap-1 md:order-none md:w-auto">
          {SLIDES.map((s, i) => (
            <button key={s.nav} type="button" onClick={() => go(i)} aria-current={i === slide ? 'step' : undefined} data-testid={`dot-${i + 1}`}
              className={`min-h-10 flex-1 rounded-full px-1 text-sm font-medium md:flex-none md:px-3 ${i === slide ? 'bg-emerald-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}>
              {i + 1}<span className="hidden lg:inline"> {s.nav}</span>
            </button>
          ))}
        </nav>
        <a href={DEMO_HREF} className="hidden text-sm font-medium text-emerald-800 underline md:inline">{T.demoCta}</a>
      </header>
      <p className="rounded-lg bg-amber-50 px-3 py-1 text-sm text-amber-900" data-testid="status">{T.status}</p>

      <div className="flex gap-2 xl:hidden" data-testid="try-bar">
        <a href={FACTORY_HREF} className={`${BTN} flex-1 bg-emerald-700 text-sm text-white`}>🏭 ลองใช้เว็บ (โรงงาน)</a>
        <a href={FARMER_HREF} className={`${BTN} flex-1 border-2 border-emerald-700 bg-white text-sm text-emerald-800`}>🌾 เกษตรกร (LINE)</a>
      </div>

      <div className="grid flex-1 gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <main className="space-y-6">
        {SLIDES.map((s, i) => (
          <section key={s.title} id={`slide-${i + 1}`} ref={(el) => { refs.current[i] = el; }} data-slide={i + 1} data-active={i === slide}
            aria-labelledby={`slide-title-${i + 1}`} className={`scroll-mt-28 space-y-3 ${i === slide ? 'block' : 'max-md:block md:hidden'}`}>
            <p className="text-sm font-medium text-slate-500">{T.slideWord} {i + 1}/{PITCH_COUNT} · {s.time}</p>
            <h2 id={`slide-title-${i + 1}`} className="text-3xl font-bold text-slate-900 md:text-4xl">{s.title}</h2>
            {s.lead ? <p className="text-lg text-slate-700 md:text-xl">{s.lead}</p> : null}

            {s.items ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {s.items.map((p) => (
                  <li key={p.text} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <span aria-hidden="true" className="text-3xl leading-none">{p.icon}</span>
                    <div className="min-w-0">{p.title ? <h3 className="text-lg font-semibold">{p.title}</h3> : null}<p className="text-base text-slate-700">{p.text}</p></div>
                  </li>
                ))}
              </ul>
            ) : null}

            {s.flow ? (
              <ol className="flex flex-col items-stretch gap-2 md:flex-row md:flex-wrap md:items-center" data-testid="flow">
                {s.flow.map((f, k) => (
                  <li key={f.text} className="flex items-center gap-2">
                    <span className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-base font-medium text-emerald-900">
                      <span aria-hidden="true" className="text-2xl">{f.icon}</span>{f.text}
                    </span>
                    {k < s.flow!.length - 1 ? <span aria-hidden="true" className="text-slate-400 max-md:hidden">→</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}

            {s.table && i === 5 ? <DataTable t={s.table} testId="table" /> : null}
            {s.formula ? (
              <div className="space-y-1 rounded-2xl border border-slate-200 bg-white p-4 font-mono text-sm md:text-base" data-testid="formula">
                {s.formula.map((f) => <p key={f} className="break-words">{f}</p>)}
              </div>
            ) : null}
            {s.assume && i === 5 ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{s.assume}</p> : null}
            {s.tableNote === '__transport__' ? <DataTable t={TRANSPORT_TABLE} testId="transport" /> : null}
            {s.table && i !== 5 ? <DataTable t={s.table} testId="table" /> : null}
            {s.assume && i !== 5 ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="assume">{s.assume}</p> : null}
            {s.warn ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-900" data-testid="warn">⚠️ {s.warn}</p> : null}

            {i === PITCH_COUNT - 1 ? (
              <div className="space-y-2">
                <a href={DEMO_HREF} className={`${BTN} bg-emerald-700 text-white`}>🚀 {T.demoCta}</a>
                <p className="text-xs text-slate-500">แหล่งอ้างอิง: {SOURCES.join(' · ')}</p>
              </div>
            ) : null}

            {i === slide ? (
              <div>
                <button type="button" onClick={() => setNotes((n) => !n)} aria-expanded={notes} className="text-sm font-medium text-emerald-800 underline">{notes ? T.hideSay : T.say}</button>
                {notes ? <p data-testid="notes" className="mt-1 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{s.say}</p> : null}
              </div>
            ) : null}
          </section>
        ))}
      </main>
      <div className="hidden xl:block"><div className="sticky top-24"><PhoneFrame /></div></div>
      </div>

      <footer className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/95 py-2">
        <button type="button" onClick={() => go(slide - 1)} disabled={slide === 0} className={`${BTN} bg-white text-slate-800 ring-1 ring-slate-300`}>← {T.prev}</button>
        <p aria-live="polite" data-testid="progress" className="text-base font-medium text-slate-700">{slide + 1} / {PITCH_COUNT}</p>
        <button type="button" onClick={() => go(slide + 1)} disabled={slide === PITCH_COUNT - 1} className={`${BTN} bg-emerald-700 text-white`}>{T.next} →</button>
      </footer>
    </div>
  );
}
