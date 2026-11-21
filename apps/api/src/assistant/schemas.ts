import { z } from 'zod';

// Output schemas for model replies (design.md "Assistant"). Model output has no authority:
// every field is whitelisted per draft kind and every object is .strict(), so unknown keys
// (status, version, org_id, published_*, source_agreement_id, ...) cause rejection, not silent drops.

export const INTENTS = [
  'SELL_MATERIAL',
  'FIND_BALER',
  'SET_DEMAND',
  'OFFER_BALING_SERVICE',
  'RESALE',
  'CHECK_STATUS',
  'GENERAL',
  'CLARIFY',
] as const;

const MATERIALS = ['RICE_STRAW', 'CANE_LEAF', 'CORN_COB', 'OTHER'] as const;
const FORMS = ['LOOSE', 'BALED'] as const;
const TRANSPORT_BY = ['SELLER', 'BUYER', 'EITHER', 'UNKNOWN'] as const;
const SERVICE_MODES = ['ON_SITE', 'AT_FACTORY', 'BOTH'] as const;
const REQUESTED_MODES = ['ON_SITE', 'AT_FACTORY'] as const;

/** Decimal string or finite positive number. Always normalized to a string (no float arithmetic later). */
const positiveDecimal = z
  .union([z.string().regex(/^\d{1,11}(\.\d{1,4})?$/), z.number().finite()])
  .transform((v) => (typeof v === 'number' ? String(v) : v))
  .refine((s) => /^\d{1,11}(\.\d{1,4})?$/.test(s) && Number(s) > 0, 'must be a positive decimal');

/** Only kg and ton. เกวียน, ไร่, bales and anything else is rejected, so the assistant must ask (Requirement 6.9). */
export const QuantityUnit = z.enum(['kg', 'ton']);
export const QuantitySchema = z.object({ value: positiveDecimal, unit: QuantityUnit }).strict();

export const PriceUnit = z.enum(['kg', 'ton']);
export const PriceSchema = z
  .object({ value: z.union([z.string().regex(/^\d{1,8}(\.\d{1,4})?$/), z.number().finite().nonnegative()]).transform(String), unit: PriceUnit })
  .strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?)?$/);
const place = z.string().trim().min(1).max(100);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const priceMode = z.enum(['FIXED', 'NEGOTIABLE']);

// -- Per-draft-kind patch whitelists -------------------------------------------------------------
export const SaleListingPatch = z
  .object({
    material_type: z.enum(MATERIALS),
    material_form: z.enum(FORMS),
    quantity: QuantitySchema,
    price_mode: priceMode,
    price: PriceSchema,
    province: place,
    district: place,
    lat,
    lng,
    available_from: isoDate,
    available_to: isoDate,
    transport_by: z.enum(TRANSPORT_BY),
  })
  .partial()
  .strict();

/** Resale also carries pending-material fields (Requirement 14.2). No source_agreement_id: the system sets it. */
export const ResaleListingPatch = SaleListingPatch.extend({
  pending_material: z.boolean(),
  expected_ready_at: isoDate,
})
  .partial()
  .strict();

export const PurchaseDemandPatch = z
  .object({
    accepted_materials: z.array(z.enum(MATERIALS)).min(1).max(4),
    accepted_forms: z.array(z.enum(FORMS)).min(1).max(2),
    target_quantity: QuantitySchema,
    min_lot: QuantitySchema,
    price_mode: priceMode,
    max_price: PriceSchema,
    province: place,
    district: place,
    lat,
    lng,
    radius_km: z.number().positive().max(80),
    accepted_provinces: z.array(place).max(10),
    window_from: isoDate,
    window_to: isoDate,
    transport_by: z.enum(TRANSPORT_BY),
    accepts_pending_material: z.boolean(),
  })
  .partial()
  .strict();

export const BalingServicePatch = z
  .object({
    material_types: z.array(z.enum(MATERIALS)).min(1).max(4),
    baling_format: place,
    service_mode: z.enum(SERVICE_MODES),
    service_provinces: z.array(place).max(10),
    province: place,
    district: place,
    lat,
    lng,
    min_quantity: QuantitySchema,
    capacity: QuantitySchema,
    price_mode: priceMode,
    price: PriceSchema,
    transport_by: z.enum(TRANSPORT_BY),
    available_from: isoDate,
    available_to: isoDate,
  })
  .partial()
  .strict();

export const BalingRequestPatch = z
  .object({
    material_type: z.enum(MATERIALS),
    quantity: QuantitySchema,
    requested_mode: z.enum(REQUESTED_MODES),
    province: place,
    district: place,
    lat,
    lng,
    needed_from: isoDate,
    needed_to: isoDate,
  })
  .partial()
  .strict();

export const DRAFT_KINDS = [
  'SALE_LISTING',
  'RESALE_LISTING',
  'PURCHASE_DEMAND',
  'BALING_SERVICE',
  'BALING_REQUEST',
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DraftPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SALE_LISTING'), fields: SaleListingPatch }).strict(),
  z.object({ kind: z.literal('RESALE_LISTING'), fields: ResaleListingPatch }).strict(),
  z.object({ kind: z.literal('PURCHASE_DEMAND'), fields: PurchaseDemandPatch }).strict(),
  z.object({ kind: z.literal('BALING_SERVICE'), fields: BalingServicePatch }).strict(),
  z.object({ kind: z.literal('BALING_REQUEST'), fields: BalingRequestPatch }).strict(),
]);
export type DraftPatch = z.infer<typeof DraftPatchSchema>;

/** Names of whitelisted fields per kind, for tests and the prompt builder. */
export const PATCH_WHITELIST: Readonly<Record<DraftKind, readonly string[]>> = {
  SALE_LISTING: Object.keys(SaleListingPatch.shape),
  RESALE_LISTING: Object.keys(ResaleListingPatch.shape),
  PURCHASE_DEMAND: Object.keys(PurchaseDemandPatch.shape),
  BALING_SERVICE: Object.keys(BalingServicePatch.shape),
  BALING_REQUEST: Object.keys(BalingRequestPatch.shape),
};

/** `{ intent, reply_text <= 1000, draft_patch?, questions? }` and nothing else. */
export const AssistantTurnSchema = z
  .object({
    intent: z.enum(INTENTS),
    reply_text: z.string().max(1000),
    draft_patch: DraftPatchSchema.optional(),
    questions: z.array(z.string().min(1).max(300)).max(5).optional(),
  })
  .strict();
export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

// -- Image assessment (Requirement 8): no moisture %, heating value, grade or standard fields ---------
export const ImageAssessmentSchema = z
  .object({
    likely_material: z.enum([...MATERIALS, 'UNKNOWN']),
    color: z.string().max(100),
    surface_condition: z.string().max(200),
    visible_contaminants: z.array(z.string().max(100)).max(10),
    limitations: z.array(z.string().max(200)).max(10),
    follow_up_questions: z.array(z.string().max(300)).max(5),
  })
  .strict();
export type ImageAssessmentResult = z.infer<typeof ImageAssessmentSchema>;

/** Safe parse of raw model text that may be wrapped in a code fence. Returns the parsed value or null. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    return null;
  }
}
