// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StoryPage } from '@/components/presentation/story-page';
import { PITCH_COUNT, SLIDES } from '@/lib/pitch-content';
import { SHOTS, activeness, cameraAt, progressFromScroll } from '@/lib/story-camera';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
beforeAll(() => {
  // jsdom has no IntersectionObserver.
  globalThis.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; } as unknown as typeof IntersectionObserver;
});
afterEach(cleanup);

describe('story camera', () => {
  it('has one shot per section', () => expect(SHOTS).toHaveLength(PITCH_COUNT));
  it('maps scroll to progress and clamps', () => {
    expect(progressFromScroll(0, 1000)).toBe(0);
    expect(progressFromScroll(1000, 1000)).toBe(8);
    expect(progressFromScroll(5000, 1000)).toBe(8);
    expect(progressFromScroll(100, 0)).toBe(0);
  });
  it('lands exactly on each shot and blends between them', () => {
    expect(cameraAt(0)).toEqual(SHOTS[0]);
    expect(cameraAt(8)).toEqual(SHOTS[8]);
    const mid = cameraAt(0.5);
    expect(mid.pos[0]).toBeCloseTo((SHOTS[0]!.pos[0] + SHOTS[1]!.pos[0]) / 2);
  });
  it('activeness peaks on its section', () => {
    expect(activeness(3, 3)).toBe(1);
    expect(activeness(3.5, 3)).toBe(0.5);
    expect(activeness(5, 3)).toBe(0);
  });
});

describe('story page', () => {
  it('renders every section with its extra text and the try links', () => {
    render(<StoryPage />);
    expect(document.querySelectorAll('[data-story]')).toHaveLength(PITCH_COUNT);
    for (const s of SLIDES) expect(screen.getByText(s.detail![0]!)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /ลองใช้เว็บ/ })[0]!.getAttribute('href')).toBe('/login?role=factory');
  });
});
