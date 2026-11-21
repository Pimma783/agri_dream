// Task 10.5: deterministic parsers for the degraded step form (pure, no model, fixed clock).
import { describe, expect, it } from 'vitest';
import {
  bangkokDate, canonicalProvince, provinceIn, endOfBangkokDayIso, matchAliases, MATERIAL_ALIASES, parseDate, parsePrice, parseProvince, parseQuantity,
  startOfBangkokDayIso,
} from '../src/domain/step-parsers.js';

const NOW = new Date('2026-03-05T03:00:00Z'); // 10:00 in Bangkok, 2026-03-05

describe('parseQuantity', () => {
  it.each([
    ['5 ตัน', '5', 'ton'],
    ['5000 กก.', '5000', 'kg'],
    ['2.5 tons', '2.5', 'ton'],
    ['๕ ตัน', '5', 'ton'],
    ['5,000 กิโลกรัม', '5000', 'kg'],
  ])('reads %s', (text, value, unit) => {
    expect(parseQuantity(text)).toEqual({ ok: true, value, unit });
  });

  it.each(['10 เกวียน', 'มี 3 ไร่', '200 มัด', '10 เกวียน 5 ตัน'])('refuses the local unit in %s', (text) => {
    expect(parseQuantity(text)).toEqual({ ok: false, reason: 'LOCAL_UNIT' });
  });

  it('asks again for a bare number, no number, two numbers or zero', () => {
    expect(parseQuantity('5')).toEqual({ ok: false, reason: 'NO_UNIT' });
    expect(parseQuantity('เยอะมาก')).toEqual({ ok: false, reason: 'NO_NUMBER' });
    expect(parseQuantity('5 ตัน หรือ 6 ตัน')).toEqual({ ok: false, reason: 'AMBIGUOUS' });
    expect(parseQuantity('0 ตัน')).toEqual({ ok: false, reason: 'INVALID' });
    expect(parseQuantity('5 ตัน 3 กก.')).toEqual({ ok: false, reason: 'AMBIGUOUS' });
  });
});

describe('parsePrice', () => {
  it('reads kg and ton prices, and bale only when allowed', () => {
    expect(parsePrice('2 บาท/กก.')).toEqual({ ok: true, value: '2', unit: 'kg' });
    expect(parsePrice('1,500 บาทต่อตัน')).toEqual({ ok: true, value: '1500', unit: 'ton' });
    expect(parsePrice('80 บาท/มัด')).toEqual({ ok: false, reason: 'LOCAL_UNIT' });
    expect(parsePrice('80 บาท/มัด', true)).toEqual({ ok: true, value: '80', unit: 'bale' });
    expect(parsePrice('3000 บาท/เกวียน', true)).toEqual({ ok: false, reason: 'LOCAL_UNIT' });
    expect(parsePrice('2 บาท')).toEqual({ ok: false, reason: 'NO_UNIT' });
  });
});

describe('parseDate (Asia/Bangkok, injected clock)', () => {
  it('resolves ISO dates and simple Thai phrases against now', () => {
    expect(parseDate('2026-04-01', NOW)).toEqual({ ok: true, date: '2026-04-01' });
    expect(parseDate('วันนี้', NOW)).toEqual({ ok: true, date: '2026-03-05' });
    expect(parseDate('พรุ่งนี้', NOW)).toEqual({ ok: true, date: '2026-03-06' });
    expect(parseDate('มะรืนนี้', NOW)).toEqual({ ok: true, date: '2026-03-07' });
    expect(parseDate('อีก 3 วัน', NOW)).toEqual({ ok: true, date: '2026-03-08' });
    expect(parseDate('อีก 2 สัปดาห์', NOW)).toEqual({ ok: true, date: '2026-03-19' });
    expect(parseDate('15/04/2026', NOW)).toEqual({ ok: true, date: '2026-04-15' });
    expect(parseDate('2569-04-01', NOW)).toEqual({ ok: true, date: '2026-04-01' });
  });

  it('uses the Bangkok day, not the UTC day, near midnight', () => {
    const late = new Date('2026-03-05T18:00:00Z'); // 01:00 on 6 March in Bangkok
    expect(bangkokDate(late)).toBe('2026-03-06');
    expect(parseDate('วันนี้', late)).toEqual({ ok: true, date: '2026-03-06' });
    expect(parseDate('2026-03-05', late)).toEqual({ ok: false, reason: 'PAST' });
  });

  it('asks again when the date is ambiguous, impossible, past or missing', () => {
    expect(parseDate('05/04/2026', NOW)).toEqual({ ok: false, reason: 'AMBIGUOUS' });
    expect(parseDate('สัปดาห์หน้า', NOW)).toEqual({ ok: false, reason: 'AMBIGUOUS' });
    expect(parseDate('พรุ่งนี้ หรือ มะรืน', NOW)).toEqual({ ok: false, reason: 'AMBIGUOUS' });
    expect(parseDate('2026-02-30', NOW)).toEqual({ ok: false, reason: 'INVALID' });
    expect(parseDate('2026-03-01', NOW)).toEqual({ ok: false, reason: 'PAST' });
    expect(parseDate('เมื่อไหร่ก็ได้', NOW)).toEqual({ ok: false, reason: 'NO_DATE' });
  });

  it('converts a Bangkok calendar day to UTC bounds', () => {
    expect(startOfBangkokDayIso('2026-04-01')).toBe('2026-03-31T17:00:00.000Z');
    expect(endOfBangkokDayIso('2026-04-01')).toBe('2026-04-01T16:59:59.000Z');
  });
});

describe('parseProvince and enum aliases', () => {
  it('accepts the pilot provinces in Thai or English and refuses the rest', () => {
    // The canonical stored value is the Thai name (same as the demo seed); English input maps to it.
    expect(parseProvince('อุตรดิตถ์')).toMatchObject({ ok: true, value: 'อุตรดิตถ์' });
    expect(parseProvince('จังหวัดนครสวรรค์')).toMatchObject({ ok: true, value: 'นครสวรรค์' });
    expect(parseProvince('จ.กำแพงเพชร')).toMatchObject({ ok: true, value: 'กำแพงเพชร' });
    expect(parseProvince('Nakhon Sawan')).toMatchObject({ ok: true, value: 'นครสวรรค์' });
    expect(canonicalProvince('Kamphaeng Phet')).toBe('กำแพงเพชร');
    expect(canonicalProvince('เชียงใหม่')).toBe('เชียงใหม่');
    expect(provinceIn(['นครสวรรค์'], 'Nakhon Sawan')).toBe(true);
    expect(provinceIn(['Uttaradit'], 'นครสวรรค์')).toBe(false);
    expect(parseProvince('เชียงใหม่')).toEqual({ ok: false, reason: 'UNKNOWN' });
  });

  it('does not read ซังข้าวโพด as rice', () => {
    expect(matchAliases('ซังข้าวโพด', MATERIAL_ALIASES)).toEqual(['CORN_COB']);
    expect(matchAliases('ฟางข้าว และ ใบอ้อย', MATERIAL_ALIASES).sort()).toEqual(['CANE_LEAF', 'RICE_STRAW']);
    expect(matchAliases('อะไรก็ได้', MATERIAL_ALIASES)).toEqual([]);
  });
});
