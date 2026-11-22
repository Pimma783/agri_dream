// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PitchDeck } from '@/components/presentation/pitch-deck';
import { PHONE_SCREENS, PITCH_COUNT, SLIDES, TRANSPORT_TABLE, parsePitchSlide, transportPerTon } from '@/lib/pitch-content';

beforeEach(() => window.history.replaceState(null, '', '/pitch'));
afterEach(cleanup);
const active = () => document.querySelector('section[data-active="true"]')!;

describe('pitch content', () => {
  it('has 9 slides and renders them all', () => {
    expect(SLIDES).toHaveLength(PITCH_COUNT);
    render(<PitchDeck slide={0} />);
    expect(document.querySelectorAll('section[data-slide]')).toHaveLength(9);
  });
  it('transport figures follow the script formula', () => {
    expect(transportPerTon(20, 6)).toBe(167);
    expect(transportPerTon(20, 15)).toBe(67);
    expect(TRANSPORT_TABLE.rows[1]).toEqual(['50 กม.', '≈ 417 บาท/ตัน', '≈ 167 บาท/ตัน']);
  });
  it('carbon arithmetic in the copy matches the formula', () => {
    const efBurn = (4.51 * 28 + 0.069 * 265) / 1000;
    const efSub = 14 * 0.0946;
    const perTon = (efBurn + 0.5 * efSub - 0.05) * 0.8;
    expect(perTon).toBeCloseTo(0.61, 2);
    expect(Math.round(12000 * perTon)).toBe(7265);
    expect(Math.round((7265 * 300) / 1e4) / 100).toBe(2.18);
    expect(Math.round((7265 * 300 * 0.4) / 1e4) / 100).toBe(0.87);
  });
  it('labels assumptions and the certification caveat', () => {
    render(<PitchDeck slide={3} />);
    expect(screen.getByTestId('warn').textContent).toMatch(/T-VER/);
    expect(screen.getByTestId('status').textContent).toMatch(/สมมติฐาน/);
    cleanup();
    render(<PitchDeck slide={7} />);
    expect(document.getElementById('slide-8')!.textContent).toMatch(/สมมติ/);
  });
});

describe('try the real site', () => {
  it('shows factory and farmer login links on every slide', () => {
    render(<PitchDeck slide={0} />);
    const bar = screen.getByTestId('try-bar');
    expect(bar.querySelector('a[href="/login?role=factory"]')).not.toBeNull();
    expect(bar.querySelector('a[href="/login?role=farmer"]')).not.toBeNull();
  });
});

describe('phone frame', () => {
  it('has one screen per slide', () => expect(PHONE_SCREENS).toHaveLength(PITCH_COUNT));
  it('follows the slide and lets a button override until the next slide', () => {
    render(<PitchDeck slide={2} />);
    const src = () => screen.getByTestId('phone-iframe').getAttribute('src');
    expect(src()).toBe('/factory/market');
    fireEvent.click(screen.getByRole('button', { name: /เกษตรกร/ , pressed: false }));
    expect(src()).toBe('/login?role=farmer');
    expect(screen.getByTestId('phone-caption').textContent).toBe('เลือกเอง');
    fireEvent.click(screen.getByRole('button', { name: /ถัดไป/ }));
    expect(src()).toBe('/factory/orders');
  });
});

describe('navigation', () => {
  it('moves with buttons and arrow keys within range and keeps ?s=', () => {
    render(<PitchDeck slide={0} />);
    const prev = screen.getByRole('button', { name: /ก่อนหน้า/ }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: /ถัดไป/ }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    expect(active().getAttribute('data-slide')).toBe('2');
    expect(window.location.search).toBe('?s=2');
    for (let i = 0; i < 12; i++) fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(active().getAttribute('data-slide')).toBe('9');
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('dot-1'));
    expect(active().getAttribute('data-slide')).toBe('1');
  });
  it('parses ?s= defensively', () => {
    expect(parsePitchSlide('9')).toBe(8);
    expect(parsePitchSlide('0')).toBe(0);
    expect(parsePitchSlide('10')).toBe(0);
    expect(parsePitchSlide(['3'])).toBe(0);
  });
  it('toggles the talking notes', () => {
    render(<PitchDeck slide={0} />);
    expect(screen.queryByTestId('notes')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ดูบทพูด' }));
    expect(screen.getByTestId('notes').textContent).toBe(SLIDES[0]!.say);
  });
});
