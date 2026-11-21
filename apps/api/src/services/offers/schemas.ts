// Input schemas for the offer service. Decimals arrive as strings (never numbers) and are bounded to the
// column precision: qty numeric(14,3), price numeric(12,4), transport cost numeric(12,2).
import { z } from 'zod';
import { type AppError, appError } from '../errors.js';

const positive = (s: string) => Number(s) > 0;
export const qtyKgStr = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/, 'ปริมาณไม่ถูกต้อง').refine(positive, 'ปริมาณต้องมากกว่า 0');
export const priceStr = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, 'ราคาไม่ถูกต้อง');
export const transportCostStr = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'ค่าขนส่งไม่ถูกต้อง');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'วันที่ไม่ถูกต้อง');
const isoInstant = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)), 'เวลาไม่ถูกต้อง');

const priceUnitSchema = z.enum(['KG', 'TON', 'BALE']);
const transportBySchema = z.enum(['SELLER', 'BUYER', 'EITHER', 'UNKNOWN']);

/** Terms the sender controls. Prices come as a pair: both set or both null. */
const termsShape = {
  qtyKg: qtyKgStr,
  unitPriceThb: priceStr.nullable().optional(),
  priceUnit: priceUnitSchema.nullable().optional(),
  transportBy: transportBySchema.optional(),
  transportCostThb: transportCostStr.nullable().optional(),
  readyDate: isoDate.nullable().optional(),
  /** ISO instant. Omitted: now + the configured default (72 h). */
  expiresAt: isoInstant.optional(),
  ackPendingMaterial: z.boolean().optional(),
};

const pricePair = (v: { unitPriceThb?: string | null | undefined; priceUnit?: string | null | undefined }) =>
  (v.unitPriceThb === null || v.unitPriceThb === undefined) === (v.priceUnit === null || v.priceUnit === undefined);
const PRICE_PAIR_MSG = 'ต้องระบุราคาและหน่วยราคาพร้อมกัน';

export const CreateOfferSchema = z
  .object({
    kind: z.enum(['PURCHASE', 'BALING_SERVICE']),
    /** Create from a stored match; it supplies the pair of referenced rows. */
    matchId: z.uuid().optional(),
    listingId: z.uuid().optional(),
    demandId: z.uuid().optional(),
    balingServiceId: z.uuid().optional(),
    balingRequestId: z.uuid().optional(),
    ...termsShape,
  })
  .strict()
  .refine(pricePair, { path: ['unitPriceThb'], message: PRICE_PAIR_MSG });
export type CreateOfferInput = z.input<typeof CreateOfferSchema>;

export const EditOfferSchema = z
  .object({
    offerId: z.uuid(),
    expectedVersion: z.number().int().min(1),
    changes: z
      .object({
        qtyKg: termsShape.qtyKg.optional(),
        unitPriceThb: termsShape.unitPriceThb,
        priceUnit: termsShape.priceUnit,
        transportBy: termsShape.transportBy,
        transportCostThb: termsShape.transportCostThb,
        readyDate: termsShape.readyDate,
        expiresAt: termsShape.expiresAt,
        ackPendingMaterial: termsShape.ackPendingMaterial,
      })
      .strict()
      .refine((c) => (c.unitPriceThb === undefined) === (c.priceUnit === undefined) && pricePair(c), {
        path: ['unitPriceThb'],
        message: PRICE_PAIR_MSG,
      })
      .refine((c) => Object.values(c).some((v) => v !== undefined), { message: 'ไม่มีเงื่อนไขที่แก้ไข' }),
  })
  .strict();
export type EditOfferInput = z.input<typeof EditOfferSchema>;

export const OfferRefSchema = z.object({ offerId: z.uuid(), expectedVersion: z.number().int().min(1).optional() }).strict();
export type OfferRefInput = z.input<typeof OfferRefSchema>;

export const idempotencyKeySchema = z.string().min(1).max(200);

export function validation(issues: readonly z.core.$ZodIssue[]): AppError {
  return appError('VALIDATION', { fields: issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
}
