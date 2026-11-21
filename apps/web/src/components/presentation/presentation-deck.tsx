'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  COPY, FACTORY_LOGIN_HREF, FARMER_LOGIN_HREF, SLIDE_COUNT, type Lang, type Point,
} from '@/lib/presentation-content';
import { ArchitectureDiagram } from './architecture-diagram';

export interface JudgeAccount { email: string; password: string }
interface Props { lang: Lang; slide: number; judge: JudgeAccount | null }

const BTN =
  'inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-40';

function PointCard({ p }: { p: Point }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <span aria-hidden="true" className="text-3xl leading-none">{p.icon}</span>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-slate-900">{p.title}</h3>
        <p className="text-base text-slate-700">{p.text}</p>
        {p.tag ? <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">{p.tag}</p> : null}
      </div>
    </li>
  );
}
const Grid = ({ children }: { children: ReactNode }) => <ul className="grid gap-3 md:grid-cols-2">{children}</ul>;

export function PresentationDeck({ lang: initialLang, slide: initialSlide, judge }: Props) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [slide, setSlide] = useState(Math.min(Math.max(initialSlide, 0), SLIDE_COUNT - 1));
  const [notes, setNotes] = useState(false);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const c = COPY[lang];

  const go = useCallback((to: number) => {
    const next = Math.min(Math.max(to, 0), SLIDE_COUNT - 1);
    setSlide(next);
    // On narrow screens every section is stacked, so bring the chosen one into view.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches) {
      refs.current[next]?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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

  // Keep ?s= and ?lang= in the address so a shared link opens the same slide and language.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('s', String(slide + 1));
    url.searchParams.set('lang', lang);
    window.history.replaceState(null, '', url);
    document.documentElement.lang = lang;
  }, [slide, lang]);

  const navs = [c.intro.nav, c.problem.nav, c.solution.nav, c.tech.nav, c.demo.nav];
  const notesFor = [c.intro.notes, c.problem.notes, c.solution.notes, c.tech.notes, c.demo.notes];
  const titles = [c.intro.title, c.problem.title, c.solution.title, c.tech.title, c.demo.title];
  const leads = [c.intro.lead, c.problem.lead, c.solution.lead, c.tech.lead, c.demo.lead];

  const body: ReactNode[] = [
    <Grid key="1">{c.intro.points.map(p => <PointCard key={p.title} p={p} />)}</Grid>,
    <div key="2" className="space-y-3">
      <Grid>{c.problem.points.map(p => <PointCard key={p.title} p={p} />)}</Grid>
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="calc">
        <h3 className="text-lg font-semibold text-amber-900">{c.problem.calcTitle}</h3>
        <p className="text-base text-amber-900">{c.problem.calc}</p>
      </div>
    </div>,
    <div key="3" className="space-y-3">
      <Grid>{c.solution.roles.map(p => <PointCard key={p.title} p={p} />)}</Grid>
      <div>
        <h3 className="mb-2 text-lg font-semibold">{c.solution.flowTitle}</h3>
        <ol className="flex flex-wrap items-center gap-2" data-testid="flow">
          {c.solution.flow.map((f, i) => (
            <li key={f} className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900 md:text-base">{i + 1}. {f}</li>
          ))}
        </ol>
      </div>
      <Grid>{c.solution.points.map(p => <PointCard key={p.title} p={p} />)}</Grid>
    </div>,
    <div key="4" className="space-y-3">
      <ArchitectureDiagram labels={c.tech.labels} />
      <Grid>{c.tech.points.map(p => <PointCard key={p.title} p={p} />)}</Grid>
    </div>,
    <div key="5" className="space-y-4">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <a href={FACTORY_LOGIN_HREF} className={`${BTN} bg-emerald-700 py-4 text-xl text-white`}>🚀 {c.demo.cta}</a>
        <a href={FARMER_LOGIN_HREF} className={`${BTN} border-2 border-emerald-700 bg-white text-emerald-800`}>🌾 {c.demo.farmerLink}</a>
      </div>
      <p className="text-base text-slate-700">{c.demo.farmerNote}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-semibold">{c.demo.stepsTitle}</h3>
          <ol className="space-y-2" data-testid="demo-steps">
            {c.demo.steps.map((s, i) => (
              <li key={s.text} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-base">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-semibold text-white">{i + 1}</span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4" data-testid="judge-account">
            <h3 className="mb-2 text-lg font-semibold text-emerald-900">🔑 {c.demo.accountTitle}</h3>
            {judge ? (
              <dl className="space-y-1 text-base">
                <div><dt className="inline font-medium">{c.demo.email}: </dt><dd className="inline break-all font-mono" data-testid="judge-email">{judge.email}</dd></div>
                <div><dt className="inline font-medium">{c.demo.password}: </dt><dd className="inline break-all font-mono" data-testid="judge-password">{judge.password}</dd></div>
              </dl>
            ) : <p className="text-base font-medium">{c.demo.accountMissing}</p>}
            <p className="mt-2 text-sm text-slate-700">{c.demo.accountNote}</p>
          </div>
          <div className="rounded-2xl border border-slate-300 bg-white p-4" data-testid="limits">
            <h3 className="mb-2 text-lg font-semibold">⚠️ {c.demo.limitsTitle}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 md:text-base">
              {c.demo.limits.map(l => <li key={l}>{l}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>,
  ];

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 px-4 py-4 md:min-h-screen">
      <header className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-2">
        <p className="text-xl font-semibold text-emerald-800">AgriMatch</p>
        <nav aria-label={c.navLabel} className="order-last flex w-full items-center gap-1 md:order-none md:w-auto">
          {navs.map((n, i) => (
            <button
              key={n} type="button" onClick={() => go(i)} aria-current={i === slide ? 'step' : undefined} data-testid={`dot-${i + 1}`}
              className={`min-h-10 flex-1 rounded-full px-2 text-sm font-medium md:flex-none md:px-3 ${i === slide ? 'bg-emerald-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}
            >{i + 1}<span className="hidden sm:inline"> {n}</span></button>
          ))}
        </nav>
        <div role="group" aria-label={c.langLabel} className="flex gap-1">
          {(['th', 'en'] as const).map(l => (
            <button
              key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
              className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${lang === l ? 'bg-emerald-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}
            >{l === 'th' ? 'ไทย' : 'EN'}</button>
          ))}
        </div>
      </header>
      <main className="flex-1 space-y-6">
        {body.map((content, i) => (
          <section
            key={i} id={`slide-${i + 1}`} ref={el => { refs.current[i] = el; }} data-slide={i + 1} data-active={i === slide}
            aria-labelledby={`slide-title-${i + 1}`}
            className={`scroll-mt-28 space-y-3 ${i === slide ? 'block' : 'max-md:block md:hidden'}`}
          >
            <p className="text-sm font-medium text-slate-500">{c.slideWord} {i + 1}/{SLIDE_COUNT}</p>
            <h2 id={`slide-title-${i + 1}`} className="text-3xl font-bold text-slate-900 md:text-4xl">{titles[i]}</h2>
            <p className="text-lg text-slate-700 md:text-xl">{leads[i]}</p>
            {content}
            {i === slide ? (
              <div>
                <button type="button" onClick={() => setNotes(n => !n)} aria-expanded={notes} className="text-sm font-medium text-emerald-800 underline">
                  {notes ? c.hideNotes : c.speakerNotes}
                </button>
                {notes ? <p data-testid="notes" className="mt-1 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{notesFor[i]}</p> : null}
              </div>
            ) : null}
          </section>
        ))}
      </main>
      <footer className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/95 py-2">
        <button type="button" onClick={() => go(slide - 1)} disabled={slide === 0} className={`${BTN} bg-white text-slate-800 ring-1 ring-slate-300`}>← {c.prev}</button>
        <p aria-live="polite" data-testid="progress" className="text-base font-medium text-slate-700">{slide + 1} / {SLIDE_COUNT}</p>
        <button type="button" onClick={() => go(slide + 1)} disabled={slide === SLIDE_COUNT - 1} className={`${BTN} bg-emerald-700 text-white`}>{c.next} →</button>
      </footer>
    </div>
  );
}
