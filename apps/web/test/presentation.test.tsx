// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PresentationPage from '@/app/presentation/page';
import { PresentationDeck } from '@/components/presentation/presentation-deck';
import { COPY, parseLang, parseSlide } from '@/lib/presentation-content';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
beforeEach(() => window.history.replaceState(null, '', '/presentation'));
afterEach(() => { cleanup(); delete process.env.JUDGE_DEMO_EMAIL; delete process.env.JUDGE_DEMO_PASSWORD; });

const active = () => document.querySelector('section[data-active="true"]')!;

describe('slides content', () => {
  for (const lang of ['th', 'en'] as const) {
    it(`renders all 5 sections in ${lang}`, () => {
      const c = COPY[lang];
      render(<PresentationDeck lang={lang} slide={0} judge={null} />);
      const titles = [c.intro.title, c.problem.title, c.solution.title, c.tech.title, c.demo.title];
      expect(document.querySelectorAll('section[data-slide]')).toHaveLength(5);
      titles.forEach((t, i) => expect(document.getElementById(`slide-title-${i + 1}`)!.textContent).toBe(t));
      expect(document.documentElement.lang).toBe(lang);
    });
  }

  it('labels estimates and keeps carbon and payments out of the MVP', () => {
    render(<PresentationDeck lang="th" slide={1} judge={null} />);
    expect(screen.getByText(/จากการสัมภาษณ์ ยังไม่มีเอกสาร/)).toBeTruthy();
    expect(screen.getByTestId('calc').textContent).toContain('ไม่ใช่ผลวัดจริง');
    expect(screen.getByTestId('limits').textContent).toMatch(/ไม่มีการชำระเงิน/);
    expect(screen.getByTestId('limits').textContent).toMatch(/T-VER/);
  });

  it('draws the deployed architecture without S3', () => {
    render(<PresentationDeck lang="en" slide={3} judge={null} />);
    const d = screen.getByTestId('architecture');
    for (const n of ['express', 'nginx', 'next', 'api', 'worker', 'rds', 'bedrock', 'line-api', 'build']) {
      expect(d.querySelector(`[data-node="${n}"]`)).not.toBeNull();
    }
    expect(d.textContent).not.toMatch(/S3/);
  });
});

describe('navigation', () => {
  it('prev/next buttons and arrow keys move the slide and stay in range', () => {
    render(<PresentationDeck lang="en" slide={0} judge={null} />);
    const prev = screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    expect(active().getAttribute('data-slide')).toBe('2');
    expect(screen.getByTestId('progress').textContent).toBe('2 / 5');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(active().getAttribute('data-slide')).toBe('3');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(active().getAttribute('data-slide')).toBe('2');
    for (let i = 0; i < 6; i++) fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(active().getAttribute('data-slide')).toBe('5');
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('dot-1'));
    expect(active().getAttribute('data-slide')).toBe('1');
  });

  it('keeps ?s= and ?lang= in the URL and the language switch', () => {
    render(<PresentationDeck lang="th" slide={2} judge={null} />);
    expect(window.location.search).toBe('?s=3&lang=th');
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(window.location.search).toBe('?s=3&lang=en');
    expect(document.getElementById('slide-title-3')!.textContent).toBe(COPY.en.solution.title);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(window.location.search).toBe('?s=4&lang=en');
  });

  it('parses query params defensively', () => {
    expect(parseSlide('4')).toBe(3);
    expect(parseSlide('9')).toBe(0);
    expect(parseSlide(['2'])).toBe(0);
    expect(parseSlide(undefined)).toBe(0);
    expect(parseLang('en')).toBe('en');
    expect(parseLang('fr')).toBe('th');
  });

  it('speaker notes toggle', () => {
    render(<PresentationDeck lang="en" slide={0} judge={null} />);
    expect(screen.queryByTestId('notes')).toBeNull();
    fireEvent.click(within(active() as HTMLElement).getByRole('button', { name: 'Speaker notes' }));
    expect(screen.getByTestId('notes').textContent).toBe(COPY.en.intro.notes);
  });
});

describe('demo slide', () => {
  it('links to the factory login and the farmer QR, with 6 steps', () => {
    render(<PresentationDeck lang="th" slide={4} judge={null} />);
    expect(screen.getByRole('link', { name: /ทดลองใช้งาน/ }).getAttribute('href')).toBe('/login?role=factory');
    expect(screen.getByRole('link', { name: /เปิด QR เกษตรกร/ }).getAttribute('href')).toBe('/login?role=farmer');
    expect(screen.getByTestId('demo-steps').querySelectorAll('li')).toHaveLength(6);
  });

  it('shows the judge account when given and a request message when absent', () => {
    const { unmount } = render(<PresentationDeck lang="en" slide={4} judge={{ email: 'judge@example.test', password: 'pw-123' }} />);
    expect(screen.getByTestId('judge-account').textContent).toContain('Factory account (for judges)');
    expect(screen.getByTestId('judge-email').textContent).toBe('judge@example.test');
    expect(screen.getByTestId('judge-password').textContent).toBe('pw-123');
    unmount();
    render(<PresentationDeck lang="th" slide={4} judge={{ email: 'a@b.test', password: 'p' }} />);
    expect(screen.getByTestId('judge-account').textContent).toContain('บัญชีโรงงาน (สำหรับกรรมการ)');
    cleanup();
    render(<PresentationDeck lang="en" slide={4} judge={null} />);
    expect(screen.getByTestId('judge-account').textContent).toContain('Ask the team for a demo account');
    expect(screen.queryByTestId('judge-email')).toBeNull();
  });

  it('page reads only the two judge variables from the server environment', async () => {
    const search = Promise.resolve({ s: '5', lang: 'en' });
    let el = await PresentationPage({ searchParams: search });
    expect(el.props).toMatchObject({ lang: 'en', slide: 4, judge: null });
    process.env.JUDGE_DEMO_EMAIL = 'j@example.test';
    el = await PresentationPage({ searchParams: search });
    expect(el.props.judge).toBeNull(); // password missing
    process.env.JUDGE_DEMO_PASSWORD = 'secret-x';
    el = await PresentationPage({ searchParams: Promise.resolve({}) });
    expect(el.props).toMatchObject({ lang: 'th', slide: 0, judge: { email: 'j@example.test', password: 'secret-x' } });
    expect(Object.keys(el.props.judge ?? {}).sort()).toEqual(['email', 'password']);
  });
});

describe('public access', () => {
  it('has no middleware and sits outside the authenticated route group', () => {
    for (const f of ['../src/middleware.ts', '../src/middleware.js', '../middleware.ts', '../middleware.js']) {
      expect(existsSync(here(f)), f).toBe(false);
    }
    expect(existsSync(here('../src/app/presentation/page.tsx'))).toBe(true);
    expect(existsSync(here('../src/app/(app)/presentation'))).toBe(false);
    const page = readFileSync(here('../src/app/presentation/page.tsx'), 'utf8');
    expect(page).not.toMatch(/redirect\(|serverApi|getMe/);
  });

  it('nginx forwards /presentation to Next.js through the catch-all location', () => {
    const conf = readFileSync(here('../../../infra/hosting/nginx.conf'), 'utf8');
    const locations = [...conf.matchAll(/location\s+(?:=\s+)?(\S+)\s*\{/g)].map(m => m[1] ?? '');
    expect(locations.some(l => '/presentation'.startsWith(l) && l !== '/')).toBe(false);
    expect(locations).toContain('/');
    expect(conf).toMatch(/location \/ \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:3000/s);
  });
});
