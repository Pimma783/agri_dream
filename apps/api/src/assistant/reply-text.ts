// Deterministic post-filter for model-written reply text (pure). The system prompt asks for Thai only, but the
// guarantee must hold even when the model ignores it: internal codes become Thai words, repeated lines and
// questions are dropped, and at most MAX_QUESTIONS questions are shown.
import { FIELD_LABEL_TH, KIND_LABEL_TH } from './prompts.js';
export const MAX_QUESTIONS = 2;
/** Known internal codes -> Thai. Longer codes first so RICE_STRAW is never cut by a shorter match. */
const CODE_TH: ReadonlyArray<readonly [string, string]> = [
  ['RICE_STRAW', 'ฟางข้าว'],
  ['CANE_LEAF', 'ใบอ้อย'],
  ['CORN_COB', 'ซังข้าวโพด'],
  ['NEGOTIABLE', 'ต่อรองได้'],
  ['FIXED', 'ตายตัว'],
  ['OTHER', 'อื่น ๆ'],
  ['KG', 'กก.'],
  ['TON', 'ตัน'],
  ['BALE', 'มัด'],
];
const CODE_MAP = new Map(CODE_TH);
const CODE_ALT = CODE_TH.map(([c]) => c).join('|');
const SNAKE_KEY = /(?<![A-Za-z0-9_])[a-z]+(?:_[a-z0-9]+)+(?![A-Za-z0-9_])/g;
const UPPER_SNAKE = /(?<![A-Za-z0-9_])[A-Z]{2,}(?:_[A-Z0-9]+)+(?![A-Za-z0-9_])/g;
const stripParen = (s: string): string => s.replace(/\s*[(（].*?[)）]/g, '');
const KEY_TH = new Map<string, string>([
  ...Object.entries(FIELD_LABEL_TH).map(([k, v]) => [k, stripParen(v)] as [string, string]),
  ['quantity', 'ปริมาณ'], ['target_quantity', 'ปริมาณที่ต้องการ'], ['min_lot', 'ปริมาณขั้นต่ำต่อรอบ'], ['min_quantity', 'ปริมาณขั้นต่ำ'],
  ['max_price', 'ราคาสูงสุด'], ['price_unit', 'หน่วยราคา'], ['min_lot_kg', 'ปริมาณขั้นต่ำต่อรอบ'], ['min_qty_kg', 'ปริมาณขั้นต่ำ'],
  ['capacity_kg', 'กำลังอัดต่อรอบ'], ['radius_km', 'รัศมีรับซื้อ'], ['district', 'อำเภอ'],
]);
const KIND_TH = new Map(Object.entries(KIND_LABEL_TH));
const WORD_ONLY = (code: string): RegExp => new RegExp(`(?<![A-Za-z0-9_])${code}(?![A-Za-z0-9_])`, 'g');
/** Replace internal codes, enum words and field keys with Thai words. */
export function replaceCodes(text: string): string {
  // Field keys and UPPER_SNAKE codes first, so qty_kg is never cut into qty_กก.
  let out = text.replace(UPPER_SNAKE, (k) => CODE_MAP.get(k) ?? KIND_TH.get(k) ?? '');
  out = out.replace(SNAKE_KEY, (k) => KEY_TH.get(k) ?? 'ข้อมูลนี้');
  // «(FIXED)» after its own Thai word is dropped; otherwise it becomes the Thai word.
  out = out.replace(new RegExp(`(\\s*)[(（]\\s*(${CODE_ALT})\\s*[)）]`, 'g'), (_m, sp: string, code: string, offset: number, whole: string) => {
    const th = CODE_MAP.get(code) ?? '';
    return whole.slice(0, offset).includes(th) && th !== '' && whole.slice(Math.max(0, offset - 30), offset).includes(th) ? '' : `${sp}${th}`;
  });
  for (const [code, th] of CODE_TH) out = out.replace(WORD_ONLY(code), th);
  // lowercase unit words
  out = out.replace(/(?<![A-Za-z])(?:kgs?|kilograms?)(?![A-Za-z])/gi, 'กก.').replace(/(?<![A-Za-z])(?:tons?|tonnes?)(?![A-Za-z])/gi, 'ตัน');
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
}
const QUESTION_END = /(?:[?？]|ไหม|หรือไม่|หรือเปล่า|เท่าไร|เท่าไหร่|อะไร|ที่ไหน|เมื่อไร|เมื่อไหร่)(?:คะ|ครับ|ค่ะ|นะคะ|นะครับ)?[?？]?\s*$/;
export const isQuestion = (s: string): boolean => QUESTION_END.test(s.trim());
/** Comparison key: ignores numbering, bullets, spaces and punctuation. */
const key = (s: string): string =>
  s.toLowerCase().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/[\s.,!?？:;()（）"'“”‘’\-–]/g, '');
/** Split a line after each question mark so «A? A?» on one line is seen as two sentences. */
const sentences = (line: string): string[] => line.split(/(?<=[?？])\s+/).filter((s) => s.trim() !== '');
/**
 * Thai-only, no repeats, at most `maxQuestions` questions. Keeps line order; a line that repeats an earlier
 * line or question (ignoring numbering and punctuation) is dropped.
 */
export function tidyReplyText(text: string, maxQuestions = MAX_QUESTIONS): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  let questions = 0;
  for (const raw of replaceCodes(text).split('\n')) {
    const line = raw.trim();
    if (line === '') {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    const parts: string[] = [];
    for (const s of sentences(line)) {
      const k = key(s);
      if (k === '' || seen.has(k)) continue;
      if (isQuestion(s)) {
        if (questions >= maxQuestions) continue;
        questions += 1;
      }
      seen.add(k);
      parts.push(s.trim());
    }
    if (parts.length > 0) kept.push(parts.join(' '));
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n');
}
/** Question list from the model: Thai-only, de-duplicated, at most `maxQuestions`. */
export function tidyQuestions(qs: readonly string[] | undefined, maxQuestions = MAX_QUESTIONS): string[] | undefined {
  if (!qs) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of qs) {
    const t = replaceCodes(q).trim();
    const k = key(t);
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= maxQuestions) break;
  }
  return out;
}
