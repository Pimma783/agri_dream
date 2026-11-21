import { describe, expect, it } from 'vitest';
import { formatDateTime, formatKg, formatThb } from '@/lib/format';

describe('format', () => {
  it('formats dates in Asia/Bangkok (UTC+7), not UTC', () => {
    // 2026-01-01T20:00Z is 03:00 on 2 Jan in Bangkok (Buddhist year 2569).
    const out = formatDateTime('2026-01-01T20:00:00Z');
    expect(out).toContain('2569');
    expect(out).toMatch(/^2 /);
    expect(out).toContain('03:00');
  });
  it('returns a dash for invalid input', () => {
    expect(formatDateTime('nope')).toBe('-');
    expect(formatKg('x')).toBe('-');
  });
  it('shows tons from 1,000 kg and money with 2 decimals', () => {
    expect(formatKg('5000')).toBe('5,000 กก. (5 ตัน)');
    expect(formatKg('250.5')).toBe('250.5 กก.');
    expect(formatThb('1250.5')).toBe('1,250.50 บาท');
  });
});
