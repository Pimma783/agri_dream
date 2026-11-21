// Pure image-assessment rules (Requirement 8.4, 8.6, 8.7). No I/O.
/** Fixed text shown wherever an image assessment is shown. Never paraphrased or translated. */
export const ASSESSMENT_DISCLAIMER_TH = 'การประเมินเบื้องต้นจากภาพ ไม่ใช่ผลตรวจคุณภาพจริง';
/**
 * Text that claims a moisture percentage, heating value, grade or standard compliance.
 * Deliberately broad: a false positive drops one observation, a false negative would publish a quality claim.
 */
export const FORBIDDEN_CLAIM_PATTERN =
  /%|เปอร์เซ็นต์|เปอร์เซนต์|เกรด|มาตรฐาน|ค่าความร้อน|kcal|\bMJ\b|\bkJ\b|percent|grade|standard|heating[ _-]?value|calorific|\bISO\b/i;
export const hasForbiddenClaim = (text: string): boolean => FORBIDDEN_CLAIM_PATTERN.test(text);
export interface StripResult<T> {
  value: T;
  /** Number of strings removed (array items) or blanked (object fields). */
  removed: number;
}
/**
 * Removes every string that makes a forbidden claim: array items are dropped, other string fields become ''.
 * Keys are scanned as well, so a field named "moisture_percent" cannot survive with a harmless value.
 */
export function stripForbiddenClaims<T>(input: T): StripResult<T> {
  let removed = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      const kept: unknown[] = [];
      for (const item of v) {
        if (typeof item === 'string' && hasForbiddenClaim(item)) removed++;
        else kept.push(walk(item));
      }
      return kept;
    }
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (hasForbiddenClaim(k)) {
          removed++;
          continue;
        }
        if (typeof val === 'string' && hasForbiddenClaim(val)) {
          removed++;
          out[k] = '';
        } else out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  const value = walk(input) as T;
  return { value, removed };
}
