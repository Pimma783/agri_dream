// Draft data: what a patch may contain, how it is normalized, and when a draft is complete.
// Stored `drafts.data` uses canonical column-style keys: quantities are kg decimal strings, prices are
// decimal strings with an upper-case unit, dates are UTC ISO strings, coordinates only when the user
// sent them (never derived from a province name; Requirement 6.6). Layer: services (no I/O here).
import { z } from 'zod';
import { canonicalProvince } from '../../domain/step-parsers.js';
import { D, parseDecimal, toKg } from '../../domain/units.js';
import type { FieldIssue } from '../errors.js';

export const DRAFT_KINDS = ['SALE_LISTING', 'RESALE_LISTING', 'PURCHASE_DEMAND', 'BALING_SERVICE', 'BALING_REQUEST'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

const MATERIALS = ['RICE_STRAW', 'CANE_LEAF', 'CORN_COB', 'OTHER'] as const;
const FORMS = ['LOOSE', 'BALED'] as const;
const TRANSPORT_BY = ['SELLER', 'BUYER', 'EITHER', 'UNKNOWN'] as const;

// ---- canonical (stored) field schemas --------------------------------------------------------
const positive = (s: string): boolean => parseDecimal(s)?.gt(0) === true;
const kgDec = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine(positive, 'must be > 0');
const priceDec = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/);
const latDec = z.string().regex(/^-?\d{1,2}(\.\d{1,6})?$/).refine((s) => Math.abs(Number(s)) <= 90, 'out of range');
const lngDec = z.string().regex(/^-?\d{1,3}(\.\d{1,6})?$/).refine((s) => Math.abs(Number(s)) <= 180, 'out of range');
const radiusDec = z.string().regex(/^\d{1,4}(\.\d{1,2})?$/).refine(positive, 'must be > 0');
const isoUtc = z.string().refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s, 'UTC ISO date');
const place = z.string().trim().min(1).max(100);
const priceMode = z.enum(['FIXED', 'NEGOTIABLE']);
const priceUnit = z.enum(['KG', 'TON']);
const priceUnitBale = z.enum(['KG', 'TON', 'BALE']);
const quality = z.record(z.string().max(50), z.union([z.string().max(200), z.number().finite(), z.boolean()])).refine((o) => Object.keys(o).length <= 20, 'too many keys');

const listingShape = {
  material_type: z.enum(MATERIALS),
  material_form: z.enum(FORMS).optional(),
  qty_kg: kgDec,
  price_mode: priceMode,
  unit_price_thb: priceDec.optional(),
  price_unit: priceUnit.optional(),
  province: place,
  district: place.optional(),
  lat: latDec.optional(),
  lng: lngDec.optional(),
  available_from: isoUtc.optional(),
  available_to: isoUtc.optional(),
  transport_by: z.enum(TRANSPORT_BY).optional(),
};

/** Canonical full-shape schemas: required keys are the completeness rule. */
export const CANONICAL = {
  SALE_LISTING: z.object(listingShape).strict(),
  RESALE_LISTING: z.object({ ...listingShape, pending_material: z.boolean(), expected_ready_at: isoUtc.optional() }).strict(),
  PURCHASE_DEMAND: z
    .object({
      accepted_materials: z.array(z.enum(MATERIALS)).min(1).max(4),
      accepted_forms: z.array(z.enum(FORMS)).min(1).max(2).optional(),
      target_qty_kg: kgDec,
      min_lot_kg: kgDec.optional(),
      price_mode: priceMode,
      max_unit_price_thb: priceDec.optional(),
      price_unit: priceUnit.optional(),
      province: place,
      district: place.optional(),
      lat: latDec.optional(),
      lng: lngDec.optional(),
      radius_km: radiusDec.optional(),
      accepted_provinces: z.array(place).max(10).optional(),
      window_from: isoUtc.optional(),
      window_to: isoUtc.optional(),
      quality: quality.optional(),
      transport_by: z.enum(TRANSPORT_BY).optional(),
      accepts_pending_material: z.boolean().optional(),
    })
    .strict(),
  BALING_SERVICE: z
    .object({
      material_types: z.array(z.enum(MATERIALS)).min(1).max(4),
      baling_format: place.optional(),
      service_mode: z.enum(['ON_SITE', 'AT_FACTORY', 'BOTH']),
      service_provinces: z.array(place).max(10).optional(),
      province: place,
      district: place.optional(),
      lat: latDec.optional(),
      lng: lngDec.optional(),
      min_qty_kg: kgDec.optional(),
      capacity_kg: kgDec.optional(),
      price_mode: priceMode,
      unit_price_thb: priceDec.optional(),
      price_unit: priceUnitBale.optional(),
      transport_by: z.enum(TRANSPORT_BY).optional(),
      available_from: isoUtc.optional(),
      available_to: isoUtc.optional(),
    })
    .strict(),
  BALING_REQUEST: z
    .object({
      material_type: z.enum(MATERIALS),
      qty_kg: kgDec,
      requested_mode: z.enum(['ON_SITE', 'AT_FACTORY']),
      province: place,
      district: place.optional(),
      lat: latDec.optional(),
      lng: lngDec.optional(),
      needed_from: isoUtc.optional(),
      needed_to: isoUtc.optional(),
    })
    .strict(),
} as const;

export type SaleListingData = z.infer<(typeof CANONICAL)['SALE_LISTING']>;
export type ResaleListingData = z.infer<(typeof CANONICAL)['RESALE_LISTING']>;
export type PurchaseDemandData = z.infer<(typeof CANONICAL)['PURCHASE_DEMAND']>;
export type BalingServiceData = z.infer<(typeof CANONICAL)['BALING_SERVICE']>;
export type BalingRequestData = z.infer<(typeof CANONICAL)['BALING_REQUEST']>;

// ---- patch (input) schemas -------------------------------------------------------------------
// `unit` of a quantity is a free string on purpose: เกวียน, ไร่ and bales parse, then toKg() reports
// UNIT_NEEDS_CONFIRMATION instead of a guessed number (Requirement 6.9). Numbers are refused as values.
const qtyIn = z.object({ value: z.string().max(30), unit: z.string().max(20) }).strict();
const priceIn = (units: readonly [string, ...string[]]) =>
  z.object({ value: z.string().max(20), unit: z.enum(units) }).strict();
const coordIn = z.union([z.string().max(20), z.number().finite()]);
const dateIn = z.string().max(40);

const listingPatch = {
  material_type: z.enum(MATERIALS),
  material_form: z.enum(FORMS),
  quantity: qtyIn,
  price_mode: priceMode,
  price: priceIn(['kg', 'ton']),
  province: place,
  district: place,
  lat: coordIn,
  lng: coordIn,
  available_from: dateIn,
  available_to: dateIn,
  transport_by: z.enum(TRANSPORT_BY),
};

export const PATCH_SCHEMAS = {
  SALE_LISTING: z.object(listingPatch).partial().strict(),
  RESALE_LISTING: z
    .object({ ...listingPatch, pending_material: z.boolean(), expected_ready_at: dateIn })
    .partial()
    .strict(),
  PURCHASE_DEMAND: z
    .object({
      accepted_materials: z.array(z.enum(MATERIALS)).min(1).max(4),
      accepted_forms: z.array(z.enum(FORMS)).min(1).max(2),
      target_quantity: qtyIn,
      min_lot: qtyIn,
      price_mode: priceMode,
      price: priceIn(['kg', 'ton']),
      province: place,
      district: place,
      lat: coordIn,
      lng: coordIn,
      radius_km: z.string().max(10),
      accepted_provinces: z.array(place).max(10),
      window_from: dateIn,
      window_to: dateIn,
      quality,
      transport_by: z.enum(TRANSPORT_BY),
      accepts_pending_material: z.boolean(),
    })
    .partial()
    .strict(),
  BALING_SERVICE: z
    .object({
      material_types: z.array(z.enum(MATERIALS)).min(1).max(4),
      baling_format: place,
      service_mode: z.enum(['ON_SITE', 'AT_FACTORY', 'BOTH']),
      service_provinces: z.array(place).max(10),
      province: place,
      district: place,
      lat: coordIn,
      lng: coordIn,
      min_quantity: qtyIn,
      capacity: qtyIn,
      price_mode: priceMode,
      price: priceIn(['kg', 'ton', 'bale']),
      transport_by: z.enum(TRANSPORT_BY),
      available_from: dateIn,
      available_to: dateIn,
    })
    .partial()
    .strict(),
  BALING_REQUEST: z
    .object({
      material_type: z.enum(MATERIALS),
      quantity: qtyIn,
      requested_mode: z.enum(['ON_SITE', 'AT_FACTORY']),
      province: place,
      district: place,
      lat: coordIn,
      lng: coordIn,
      needed_from: dateIn,
      needed_to: dateIn,
    })
    .partial()
    .strict(),
} as const;

export type DraftPatchInput<K extends DraftKind = DraftKind> = z.input<(typeof PATCH_SCHEMAS)[K]>;

const QUANTITY_KEYS: Readonly<Record<string, string>> = {
  quantity: 'qty_kg',
  target_quantity: 'target_qty_kg',
  min_lot: 'min_lot_kg',
  min_quantity: 'min_qty_kg',
  capacity: 'capacity_kg',
};
const PRICE_FIELD: Readonly<Record<DraftKind, string | null>> = {
  SALE_LISTING: 'unit_price_thb',
  RESALE_LISTING: 'unit_price_thb',
  PURCHASE_DEMAND: 'max_unit_price_thb',
  BALING_SERVICE: 'unit_price_thb',
  BALING_REQUEST: null,
};
export const priceFieldOf = (kind: DraftKind): string | null => PRICE_FIELD[kind];

const issue = (path: string, message: string): FieldIssue => ({ path, message });

function fromZod(error: z.ZodError, prefix = ''): FieldIssue[] {
  return error.issues.map((i) => issue(prefix + i.path.join('.'), i.message));
}

/** Coordinates normalized to 6 decimals; null when the value is not a plain decimal. */
function coordString(v: string | number): string | null {
  const d = parseDecimal(typeof v === 'number' ? String(v) : v);
  return d === null ? null : new D(d).toFixed(6);
}

function isoOf(v: string): string | null {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export type NormalizedPatch = { ok: true; fields: Record<string, unknown> } | { ok: false; issues: FieldIssue[] };

/** Validate a user/assistant patch for `kind` and convert it to canonical stored keys. */
export function normalizePatch(kind: DraftKind, raw: unknown): NormalizedPatch {
  const parsed = PATCH_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) return { ok: false, issues: fromZod(parsed.error) };
  const input = parsed.data as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  const issues: FieldIssue[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key in QUANTITY_KEYS) {
      const q = value as { value: string; unit: string };
      const r = toKg(q);
      if (!r.ok) issues.push(issue(key, r.code === 'NEEDS_CONFIRMATION' ? 'UNIT_NEEDS_CONFIRMATION' : 'INVALID_VALUE'));
      else fields[QUANTITY_KEYS[key] as string] = r.kg.toFixed(3);
    } else if (key === 'price') {
      const p = value as { value: string; unit: string };
      const d = parseDecimal(p.value);
      if (d === null || d.isNegative()) issues.push(issue('price', 'INVALID_VALUE'));
      else {
        fields[PRICE_FIELD[kind] as string] = d.toFixed(4);
        fields.price_unit = p.unit.toUpperCase();
      }
    } else if (key === 'lat' || key === 'lng') {
      const c = coordString(value as string | number);
      if (c === null) issues.push(issue(key, 'INVALID_VALUE'));
      else fields[key] = c;
    } else if (key === 'radius_km') {
      const d = parseDecimal(value as string);
      if (d === null || !d.gt(0)) issues.push(issue(key, 'INVALID_VALUE'));
      else fields[key] = d.toFixed(2);
    } else if (key.endsWith('_from') || key.endsWith('_to') || key === 'expected_ready_at') {
      const iso = isoOf(value as string);
      if (iso === null) issues.push(issue(key, 'INVALID_DATE'));
      else fields[key] = iso;
    } else if (key === 'province') {
      fields[key] = canonicalProvince(value as string);
    } else if (key === 'accepted_provinces' || key === 'service_provinces') {
      fields[key] = (value as string[]).map(canonicalProvince);
    } else {
      fields[key] = value;
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, fields };
}

/** Apply a normalized patch to stored data. Switching to NEGOTIABLE drops any stored price. */
export function mergeData(kind: DraftKind, data: Record<string, unknown>, fields: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...data, ...fields };
  const priceField = PRICE_FIELD[kind];
  if (priceField && fields.price_mode === 'NEGOTIABLE' && !(priceField in fields)) {
    delete merged[priceField];
    delete merged.price_unit;
  }
  return merged;
}

const dateOf = (v: unknown): number | null => (typeof v === 'string' ? Date.parse(v) : null);

/** Rules that hold for any stored data, complete or not. */
export function consistencyIssues(kind: DraftKind, data: Record<string, unknown>): FieldIssue[] {
  const out: FieldIssue[] = [];
  const priceField = PRICE_FIELD[kind];
  if (priceField && data.price_mode === 'NEGOTIABLE' && priceField in data) {
    out.push(issue('price', 'NEGOTIABLE_HAS_NO_PRICE')); // NEGOTIABLE is never a price of 0
  }
  if ('lat' in data !== 'lng' in data) out.push(issue('lat', 'LAT_LNG_TOGETHER'));
  const pairs: [string, string][] = [['available_from', 'available_to'], ['window_from', 'window_to'], ['needed_from', 'needed_to']];
  for (const [a, b] of pairs) {
    const from = dateOf(data[a]);
    const to = dateOf(data[b]);
    if (from !== null && to !== null && to < from) out.push(issue(b, 'BEFORE_START'));
  }
  const minLot = parseDecimal(String(data.min_lot_kg ?? ''));
  const target = parseDecimal(String(data.target_qty_kg ?? ''));
  if (minLot && target && minLot.gt(target)) out.push(issue('min_lot', 'ABOVE_TARGET'));
  return out;
}

export interface Completeness {
  complete: boolean;
  /** Paths of fields that are missing or invalid. Computed, never stored. */
  missing: string[];
}

/** A draft is complete when it satisfies the canonical schema and the publish-time rules. */
export function completeness(kind: DraftKind, data: Record<string, unknown>): Completeness {
  const missing = new Set<string>();
  const parsed = CANONICAL[kind].safeParse(data);
  if (!parsed.success) for (const i of parsed.error.issues) missing.add(String(i.path[0] ?? '(root)'));
  for (const i of consistencyIssues(kind, data)) missing.add(i.path);
  if (data.price_mode === 'FIXED') {
    const f = PRICE_FIELD[kind];
    if (f && (data[f] === undefined || data.price_unit === undefined)) missing.add('price');
  }
  if (kind === 'RESALE_LISTING' && data.pending_material === true && data.expected_ready_at === undefined) {
    missing.add('expected_ready_at'); // Requirement 14.6
  }
  const list = [...missing];
  return { complete: list.length === 0, missing: list };
}
