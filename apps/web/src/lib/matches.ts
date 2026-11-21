// Pure helpers for the match pages: Thai labels and number formatting. No contact data is ever handled here.
import type { MatchEntityKind, MatchFlagCode, MatchView } from '@agrimatch/contracts';
import { FIELD_LABEL } from './postings';

export const COMPONENT_LABEL: Record<string, string> = {
  distance: 'ระยะทาง',
  quantity: 'ปริมาณ',
  price: 'ราคา',
  time: 'ช่วงเวลา',
  conditions: 'เงื่อนไข',
  serviceArea: 'พื้นที่บริการ',
  materialForm: 'วัสดุและรูปแบบ',
};

export const ENTITY_LABEL: Record<MatchEntityKind, string> = {
  LISTING: 'ประกาศขาย',
  DEMAND: 'ประกาศรับซื้อ',
  BALING_REQUEST: 'คำขอจ้างอัด',
  BALING_SERVICE: 'บริการรับจ้างอัด',
};

export const TIER_LABEL: Record<0 | 1, string> = { 0: 'ตรงเงื่อนไข', 1: 'ต้องตรวจเพิ่ม' };

export const FLAG_CHIP_TH: Record<MatchFlagCode, string> = {
  INCOMPLETE: 'ข้อมูลไม่ครบ',
  NEEDS_CONFIRMATION: 'ต้องสอบถาม/ตรวจเพิ่ม',
  DISTANCE_UNVERIFIED: 'ระยะเส้นตรง ไม่ใช่ระยะขับรถ',
  PRICE_MISMATCH: 'ราคาไม่ตรง',
};

export const NO_CONTACT_NOTICE = 'แสดงเฉพาะจังหวัดของคู่ค้า ไม่แสดงข้อมูลติดต่อ จนกว่าจะมีข้อตกลง';

/** Where the "start an offer" button goes (the form lives at /offers/new). */
export function offerHref(matchId: string): string {
  return `/offers/new?match_id=${encodeURIComponent(matchId)}`;
}

export function flagChipText(f: MatchView['flags'][number]): string {
  const base = FLAG_CHIP_TH[f.code];
  if (f.code === 'NEEDS_CONFIRMATION' && f.field) return `${base}: ${FIELD_LABEL[f.field] ?? f.field}`;
  return base;
}

/** "0.8125" -> "81%". Components and weights are fractions in [0, 1]. */
export function fractionPct(v: string | null): string {
  if (v === null) return 'ไม่มีข้อมูล';
  const n = Number(v);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '-';
}

/** "86.50" -> "86.5". The score is 0-100 already. */
export function scoreText(score: string): string {
  const n = Number(score);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '-';
}

export function counterpartyName(c: MatchView['counterparty']): string {
  return c.display_name ?? 'เกษตรกร (ไม่เปิดเผยชื่อ)';
}

export function findMatch(list: MatchView[], id: string): MatchView | undefined {
  return list.find((m) => m.id === id);
}
