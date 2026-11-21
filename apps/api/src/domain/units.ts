// Pure layer. Branded decimal quantities and prices (design.md: Components, `domain/units.ts`).
// Arithmetic never goes through `number`: values enter as strings or Decimals and leave as strings.
import { Decimal } from 'decimal.js';

// Private Decimal constructor so we do not change the global decimal.js config.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const KG_SCALE = 3; // numeric(14,3)
export const PRICE_SCALE = 4; // numeric(12,4)
export const TOTAL_SCALE = 2; // numeric(14,2)
export const KG_PER_TON = 1000;

declare const kgBrand: unique symbol;
declare const moneyBrand: unique symbol;
export type Kg = Dec & { readonly [kgBrand]: true };
export type Money = Dec & { readonly [moneyBrand]: true };

export type DecimalInput = string | Dec;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Parse a decimal from a string or Decimal. Numbers are refused on purpose. Returns null if not a finite decimal. */
export function parseDecimal(input: DecimalInput): Dec | null {
  if (typeof input === 'string') {
    const s = input.trim();
    if (!DECIMAL_STRING.test(s)) return null;
    return new D(s);
  }
  // Runtime guard: values come from AI output and LINE text, so the type may be wrong.
  if (Decimal.isDecimal(input)) return input.isFinite() ? new D(input) : null;
  return null;
}

/** Round half up to `scale` decimal places. */
export function roundHalfUp(value: Dec, scale: number): Dec {
  return value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
}

function mustParse(input: DecimalInput, what: string): Dec {
  const d = parseDecimal(input);
  if (d === null) throw new TypeError(`${what}: not a decimal`);
  return d;
}

/** Build a Kg value (rounded half up to 3 places). Throws on non-decimal input. */
export function kg(input: DecimalInput): Kg {
  return roundHalfUp(mustParse(input, 'kg'), KG_SCALE) as Kg;
}

/** Build a Money value (rounded half up to 4 places). Throws on non-decimal input. */
export function money(input: DecimalInput): Money {
  return roundHalfUp(mustParse(input, 'money'), PRICE_SCALE) as Money;
}

/** Round a total to 2 places (numeric(14,2)). */
export function roundTotal(value: Dec): Money {
  return roundHalfUp(value, TOTAL_SCALE) as Money;
}

// ---- Database and JSON boundary ----

export function kgFromDb(s: string): Kg {
  return kg(s);
}
export function kgToDb(v: Kg): string {
  return v.toFixed(KG_SCALE, Decimal.ROUND_HALF_UP);
}
export function moneyFromDb(s: string): Money {
  return money(s);
}
/** Default 4 places (price). Pass TOTAL_SCALE for totals. */
export function moneyToDb(v: Money, scale: number = PRICE_SCALE): string {
  return v.toFixed(scale, Decimal.ROUND_HALF_UP);
}

// ---- Quantity units ----

export const SUPPORTED_QUANTITY_UNITS = ['kg', 'ton'] as const;
export type QuantityUnit = (typeof SUPPORTED_QUANTITY_UNITS)[number];

export type ToKgResult =
  | { ok: true; kg: Kg }
  | { ok: false; code: 'NEEDS_CONFIRMATION' | 'INVALID_VALUE' };

/**
 * Convert a quantity to kilograms. Only `kg` and `ton` are converted (1 ton = 1000 kg, exact).
 * Any other unit (เกวียน, ไร่, bales, ...) returns NEEDS_CONFIRMATION and no number (Requirement 6.9).
 * Negative or non-decimal values return INVALID_VALUE.
 */
export function toKg(q: { value: DecimalInput; unit: string }): ToKgResult {
  if (q.unit !== 'kg' && q.unit !== 'ton') return { ok: false, code: 'NEEDS_CONFIRMATION' };
  const v = parseDecimal(q.value);
  if (v === null || v.isNegative()) return { ok: false, code: 'INVALID_VALUE' };
  const inKg = q.unit === 'ton' ? v.times(KG_PER_TON) : v;
  return { ok: true, kg: kg(inKg) };
}

// ---- Price units ----

export const PRICE_UNITS = ['THB_PER_KG', 'THB_PER_TON', 'THB_PER_BALE'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/**
 * Normalize a price to THB per kg. Per-bale and unknown units return null because the
 * weight of a bale is not known (never guessed). Result is rounded half up to 4 places.
 */
export function normalizePriceToThbPerKg(price: Money, unit: string): Money | null {
  if (unit === 'THB_PER_KG') return price;
  if (unit === 'THB_PER_TON') return money(price.div(KG_PER_TON));
  return null;
}
