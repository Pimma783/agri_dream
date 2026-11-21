// Pure layer. Deterministic parsers for the degraded step form (Requirement 4.11, 6.9; design.md "degraded mode").
// No model, no I/O, no clock: dates are resolved against a `now` the caller injects (Asia/Bangkok, UTC+7, no DST).
// Every parser either returns a value that is safe to hand to the draft service or a reason to ask again.
import { parseDecimal } from './units.js';

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** Thai digits to ASCII, full-width forms folded, comma thousands separators removed, spaces collapsed. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10))
    .replace(/[๐-๙]/g, (c) => String(THAI_DIGITS.indexOf(c)))
    .replace(/(\d),(?=\d{3}(\D|$))/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- quantity and price -------------------------------------------------------------------------
const LOCAL_UNIT = /เกวียน|ไร่|งาน|ตารางวา|มัด|ก้อน|ฟ่อน|\bbales?\b|\brai\b|\bkwian\b/i;
const KG_UNIT = /กิโลกรัม|กิโล|กก\.?|\bkgs?\b|\bkilograms?\b/i;
const TON_UNIT = /ตัน|\btons?\b|\btonnes?\b|\bmt\b/i;
const NUMBER = /\d+(?:\.\d+)?/g;

export type QuantityParse =
  | { ok: true; value: string; unit: 'kg' | 'ton' }
  | { ok: false; reason: 'LOCAL_UNIT' | 'NO_UNIT' | 'NO_NUMBER' | 'AMBIGUOUS' | 'INVALID' };

const DECIMAL_OK = /^\d{1,11}(\.\d{1,4})?$/;

function singleNumber(text: string): string | 'NONE' | 'MANY' {
  const nums = text.match(NUMBER) ?? [];
  if (nums.length === 0) return 'NONE';
  if (nums.length > 1) return 'MANY';
  return nums[0] as string;
}

/** "5 ตัน", "5000 กก.", "2.5 tons". Only kg and ton are accepted: เกวียน, ไร่, มัด and bare numbers return a reason to ask. */
export function parseQuantity(input: string): QuantityParse {
  const text = normalizeText(input);
  // Any local unit, even next to a metric one ("10 เกวียน 5 ตัน"), means two quantities: ask, do not guess.
  if (LOCAL_UNIT.test(text)) return { ok: false, reason: 'LOCAL_UNIT' };
  const n = singleNumber(text);
  if (n === 'NONE') return { ok: false, reason: 'NO_NUMBER' };
  if (n === 'MANY') return { ok: false, reason: 'AMBIGUOUS' };
  const kg = KG_UNIT.test(text);
  const ton = TON_UNIT.test(text);
  if (kg === ton) return { ok: false, reason: kg ? 'AMBIGUOUS' : 'NO_UNIT' };
  if (!DECIMAL_OK.test(n)) return { ok: false, reason: 'INVALID' };
  const d = parseDecimal(n);
  if (d === null || !d.gt(0)) return { ok: false, reason: 'INVALID' };
  return { ok: true, value: n, unit: kg ? 'kg' : 'ton' };
}

export type PriceUnitIn = 'kg' | 'ton' | 'bale';
export type PriceParse =
  | { ok: true; value: string; unit: PriceUnitIn }
  | { ok: false; reason: 'LOCAL_UNIT' | 'NO_UNIT' | 'NO_NUMBER' | 'AMBIGUOUS' | 'INVALID' };

const PRICE_DECIMAL_OK = /^\d{1,8}(\.\d{1,4})?$/;
const BALE_UNIT = /มัด|ก้อน|\bbales?\b/i;

/** "2 บาท/กก.", "1500 บาทต่อตัน". `allowBale` is for baling services, priced per bale. */
export function parsePrice(input: string, allowBale = false): PriceParse {
  const text = normalizeText(input).replace(/฿|บาท|\bbaht\b|\bthb\b/gi, ' ');
  const n = singleNumber(text);
  if (n === 'NONE') return { ok: false, reason: 'NO_NUMBER' };
  if (n === 'MANY') return { ok: false, reason: 'AMBIGUOUS' };
  const kg = KG_UNIT.test(text);
  const ton = TON_UNIT.test(text);
  const bale = BALE_UNIT.test(text);
  const otherLocal = /เกวียน|ไร่|งาน|ตารางวา|ฟ่อน|\brai\b|\bkwian\b/i.test(text);
  if (otherLocal || (bale && !allowBale)) return { ok: false, reason: 'LOCAL_UNIT' };
  const count = Number(kg) + Number(ton) + Number(bale);
  if (count === 0) return { ok: false, reason: 'NO_UNIT' };
  if (count > 1) return { ok: false, reason: 'AMBIGUOUS' };
  if (!PRICE_DECIMAL_OK.test(n)) return { ok: false, reason: 'INVALID' };
  return { ok: true, value: n, unit: kg ? 'kg' : ton ? 'ton' : 'bale' };
}

// ---- dates ----------------------------------------------------------------------------------------
export type DateParse =
  | { ok: true; date: string }
  | { ok: false; reason: 'NO_DATE' | 'AMBIGUOUS' | 'INVALID' | 'PAST' };

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) in Asia/Bangkok at `now`. */
export function bangkokDate(now: Date): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

const pad = (n: number): string => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2200) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Buddhist Era years (2500+) are converted to Gregorian. */
const gregorian = (y: number): number => (y >= 2400 ? y - 543 : y);

/**
 * ISO (2026-03-05), d/m/y when only one reading is valid, and simple Thai phrases: วันนี้, พรุ่งนี้, มะรืนนี้, อีก N วัน,
 * อีก N สัปดาห์. "05/03/2026" is ambiguous (d/m or m/d), and so are "สัปดาห์หน้า" and "เดือนหน้า": the caller asks again.
 * Past dates are refused. The result is a calendar date in Asia/Bangkok.
 */
export function parseDate(input: string, now: Date): DateParse {
  const text = normalizeText(input);
  const today = bangkokDate(now);
  const found = new Set<string>();
  let invalid = false;
  let ambiguous = false;
  let rest = text;

  const take = (re: RegExp, fn: (m: RegExpExecArray) => void): void => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      fn(m);
      return ' ';
    });
  };

  take(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (m) => {
    const v = validDate(gregorian(Number(m[1])), Number(m[2]), Number(m[3]));
    if (v) found.add(v);
    else invalid = true;
  });
  take(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/g, (m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = gregorian(Number(m[3]));
    const dm = validDate(y, b, a); // d/m/y
    const md = validDate(y, a, b); // m/d/y
    if (dm && md && dm !== md) ambiguous = true;
    else if (dm ?? md) found.add((dm ?? md) as string);
    else invalid = true;
  });
  take(/อีก\s*(\d{1,3})\s*(วัน|สัปดาห์|อาทิตย์)/g, (m) => {
    const n = Number(m[1]);
    found.add(addDays(today, m[2] === 'วัน' ? n : n * 7));
  });
  take(/มะรืน(?:นี้)?/g, () => found.add(addDays(today, 2)));
  take(/พรุ่งนี้/g, () => found.add(addDays(today, 1)));
  take(/วันนี้/g, () => found.add(today));
  if (/สัปดาห์หน้า|อาทิตย์หน้า|เดือนหน้า|ปีหน้า|ต้นเดือน|กลางเดือน|สิ้นเดือน|ปลายเดือน|เร็วๆ นี้|เร็ว ๆ นี้|ช่วง/.test(rest)) ambiguous = true;

  if (ambiguous || found.size > 1) return { ok: false, reason: 'AMBIGUOUS' };
  if (invalid) return { ok: false, reason: 'INVALID' };
  const [date] = [...found];
  if (date === undefined) return { ok: false, reason: 'NO_DATE' };
  if (date < today) return { ok: false, reason: 'PAST' };
  return { ok: true, date };
}

/** Start of the Bangkok day as a UTC ISO string (what the draft service stores). */
export function startOfBangkokDayIso(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - BANGKOK_OFFSET_MS).toISOString();
}
/** Last whole second of the Bangkok day, for "available until" style fields. */
export function endOfBangkokDayIso(date: string): string {
  return new Date(Date.parse(`${date}T23:59:59Z`) - BANGKOK_OFFSET_MS).toISOString();
}

// ---- provinces ------------------------------------------------------------------------------------
/**
 * Pilot provinces (product.md). The canonical stored value is the Thai name, the same form the demo seed uses and
 * the Dashboard shows. English names are accepted as input and as legacy stored data (`en`).
 */
export const PILOT_PROVINCES = [
  { value: 'อุตรดิตถ์', th: 'อุตรดิตถ์', en: 'Uttaradit', aliases: ['uttaradit', 'utaradit'] },
  { value: 'นครสวรรค์', th: 'นครสวรรค์', en: 'Nakhon Sawan', aliases: ['nakhon sawan', 'nakhonsawan', 'nakorn sawan'] },
  { value: 'กำแพงเพชร', th: 'กำแพงเพชร', en: 'Kamphaeng Phet', aliases: ['kamphaeng phet', 'kamphaengphet', 'kampaeng phet'] },
] as const;
export type ProvinceParse = { ok: true; value: string; th: string } | { ok: false; reason: 'UNKNOWN' };
const stripProvincePrefix = (input: string): string =>
  normalizeText(input).replace(/^(จังหวัด|จ\.|จ )\s*/u, '').trim().toLowerCase();
/** "อุตรดิตถ์", "จ.อุตรดิตถ์", "จังหวัดนครสวรรค์", "Kamphaeng Phet". Anything else asks again (no guessing). */
export function parseProvince(input: string): ProvinceParse {
  const t = stripProvincePrefix(input);
  for (const p of PILOT_PROVINCES) {
    if (t === p.th || t === p.en.toLowerCase() || (p.aliases as readonly string[]).includes(t)) return { ok: true, value: p.value, th: p.th };
  }
  return { ok: false, reason: 'UNKNOWN' };
}
/** The one stored form of a province: a pilot province in any known spelling becomes its Thai name; other text is kept as given. */
export function canonicalProvince(value: string): string {
  const p = parseProvince(value);
  return p.ok ? p.value : value;
}
/** True when `province` is in `list`, comparing canonical forms so legacy English rows still match Thai ones. */
export const provinceIn = (list: readonly string[], province: string): boolean => {
  const c = canonicalProvince(province);
  return list.some((p) => canonicalProvince(p) === c);
};
export const provinceLabelTh = (value: unknown): string => (typeof value === 'string' ? canonicalProvince(value) : String(value));
// ---- enums -------------------------------------------------------------------------------------------
export type Alias<T extends string> = { readonly value: T; readonly words: readonly string[] };

/** All distinct enum values mentioned in `text`; matched words are consumed so "ข้าวโพด" is not read as "ข้าว". */
export function matchAliases<T extends string>(input: string, table: readonly Alias<T>[]): T[] {
  let rest = normalizeText(input).toLowerCase();
  const flat = table.flatMap((a) => a.words.map((w) => ({ w: w.toLowerCase(), v: a.value }))).sort((x, y) => y.w.length - x.w.length);
  const out = new Set<T>();
  for (const { w, v } of flat) {
    if (rest.includes(w)) {
      out.add(v);
      rest = rest.split(w).join(' ');
    }
  }
  return [...out];
}

export const MATERIAL_ALIASES: readonly Alias<'RICE_STRAW' | 'CANE_LEAF' | 'CORN_COB' | 'OTHER'>[] = [
  { value: 'RICE_STRAW', words: ['ฟางข้าว', 'ฟาง', 'rice_straw', 'rice straw'] },
  { value: 'CANE_LEAF', words: ['ใบอ้อย', 'อ้อย', 'cane_leaf', 'cane leaf'] },
  { value: 'CORN_COB', words: ['ซังข้าวโพด', 'ซัง', 'ข้าวโพด', 'corn_cob', 'corn cob'] },
  { value: 'OTHER', words: ['อื่นๆ', 'อื่น ๆ', 'อื่น', 'other'] },
];
export const PRICE_MODE_ALIASES: readonly Alias<'FIXED' | 'NEGOTIABLE'>[] = [
  { value: 'FIXED', words: ['ราคาตายตัว', 'ตายตัว', 'fixed'] },
  { value: 'NEGOTIABLE', words: ['ต่อรองได้', 'ต่อรอง', 'negotiable'] },
];
export const SERVICE_MODE_ALIASES: readonly Alias<'ON_SITE' | 'AT_FACTORY' | 'BOTH'>[] = [
  { value: 'BOTH', words: ['ทั้งสองแบบ', 'ทั้งสอง', 'both'] },
  { value: 'ON_SITE', words: ['ที่แปลง', 'ในแปลง', 'on_site', 'on site'] },
  { value: 'AT_FACTORY', words: ['ที่โรงงาน', 'โรงงาน', 'at_factory', 'at factory'] },
];
export const REQUESTED_MODE_ALIASES: readonly Alias<'ON_SITE' | 'AT_FACTORY'>[] = SERVICE_MODE_ALIASES.filter(
  (a) => a.value !== 'BOTH',
) as readonly Alias<'ON_SITE' | 'AT_FACTORY'>[];
export const READY_ALIASES: readonly Alias<'READY' | 'PENDING'>[] = [
  { value: 'PENDING', words: ['ยังไม่พร้อม', 'ยังไม่', 'pending'] },
  { value: 'READY', words: ['พร้อมแล้ว', 'พร้อม', 'ready'] },
];
