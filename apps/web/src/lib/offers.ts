// Pure helpers and API calls for offers and agreements. Wording never claims payment, delivery or quality (Requirement 19).
import {
  acceptOfferResultSchema,
  draftViewSchema,
  offerResultSchema,
  type AgreementStatus,
  type AgreementView,
  type CreateOfferRequest,
  type DraftView,
  type OfferView,
  type TransportBy,
} from '@agrimatch/contracts';
import { browserApi } from './api';
import type { ApiCore } from './api-core';
import { formatThb } from './format';

export type OffersApi = Pick<ApiCore, 'post'>;
export const defaultOffersApi: OffersApi = browserApi;

export const OFFER_KIND_LABEL = { PURCHASE: 'ซื้อขายวัสดุ', BALING_SERVICE: 'จ้างอัดฟาง' } as const;
export const PRICE_UNIT_LABEL = { KG: 'กก.', TON: 'ตัน', BALE: 'ก้อน' } as const;
export const OFFER_PRICE_UNITS = [
  { value: 'TON', label: 'ตัน' },
  { value: 'KG', label: 'กก.' },
] as const;
export const BALING_PRICE_UNITS = [...OFFER_PRICE_UNITS, { value: 'BALE', label: 'ก้อน' }] as const;

export const AGREEMENT_NOTICE =
  'ข้อตกลงนี้บันทึกเพียงว่าทั้งสองฝ่ายยืนยันเงื่อนไขในระบบ ไม่ใช่การชำระเงิน การส่งมอบ หรือการรับรองคุณภาพ';
export const AGREEMENT_STATUS_TEXT: Record<AgreementStatus, string> = {
  PURCHASE_CONFIRMED: 'ยืนยันการซื้อแล้ว',
  SERVICE_CONFIRMED: 'ยืนยันบริการแล้ว',
  NEEDS_REVIEW: 'ต้องตรวจสอบ',
  CANCELLED: 'ยกเลิกแล้ว',
};
export const INSUFFICIENT_QUANTITY_TH = 'ปริมาณคงเหลือไม่พอ ข้อเสนอนี้ยังคงรอตอบรับอยู่ ไม่ถูกยกเลิก';
export const PENDING_ACK_TH = 'ฉันรับทราบว่าวัสดุนี้ยังอยู่ระหว่างรอรับหรือรออัด และอาจยังไม่พร้อมส่งมอบ';
export const TRANSPORT_COST_UNKNOWN_TH = 'ยังไม่ทราบ (ไม่รวมในยอดรวม)';

export function priceText(unitPrice: string | null, unit: OfferView['price_unit']): string {
  if (unitPrice === null || unit === null) return 'ยังไม่ระบุราคา';
  const n = Number(unitPrice);
  if (!Number.isFinite(n)) return '-';
  return `${formatThb(unitPrice).replace(' บาท', '')} บาท/${PRICE_UNIT_LABEL[unit]}`;
}

/** Total only when the API computed it. Transport cost is never part of it. */
export function totalText(total: string | null): string {
  return total === null ? 'ยังคำนวณยอดรวมไม่ได้ (ราคาไม่ครบหรือหน่วยไม่รองรับ)' : formatThb(total);
}

export function transportCostText(cost: string | null): string {
  return cost === null ? TRANSPORT_COST_UNKNOWN_TH : `${formatThb(cost)} (แยกจากยอดรวม)`;
}

export const TRANSPORT_BY_LABEL: Record<TransportBy, string> = {
  SELLER: 'ผู้ขายส่งให้',
  BUYER: 'ผู้ซื้อไปรับเอง',
  EITHER: 'ได้ทั้งสองแบบ',
  UNKNOWN: 'ยังไม่ระบุ',
};

export type OfferActions = { accept: boolean; reject: boolean; withdraw: boolean; edit: boolean };
/** Receiver accepts or rejects, sender withdraws or edits, only while PENDING. */
export function offerActions(o: Pick<OfferView, 'status' | 'direction'>): OfferActions {
  const pending = o.status === 'PENDING';
  const received = o.direction === 'received';
  return { accept: pending && received, reject: pending && received, withdraw: pending && !received, edit: pending && !received };
}

/** "5000.000" -> milligram-free integer thousandths, so quantity sums need no floating point. */
function toMilli(v: string): bigint {
  const [i = '0', f = ''] = v.split('.');
  return BigInt(i) * 1000n + BigInt(f.padEnd(3, '0').slice(0, 3));
}
/** qty - reserved as a decimal string with three places, never below 0. */
export function remainingKg(qtyKg: string, reservedKg: string): string {
  const d = toMilli(qtyKg) - toMilli(reservedKg);
  const v = d < 0n ? 0n : d;
  return `${v / 1000n}.${String(v % 1000n).padStart(3, '0')}`;
}

/** The BALER buyer of a confirmed purchase can open a resale draft. */
export function canCreateResale(a: AgreementView, me: { org_id: string; role: string }): boolean {
  return me.role === 'BALER' && a.kind === 'PURCHASE' && a.status === 'PURCHASE_CONFIRMED' && a.buyer_org_id === me.org_id;
}

export function resaleDraftHref(draftId: string): string {
  return `/resale/${encodeURIComponent(draftId)}`;
}

// ---- Terms form ---------------------------------------------------------------------------------

export interface OfferTermsForm {
  qty: string;
  qtyUnit: 'kg' | 'ton';
  price: string;
  priceUnit: 'KG' | 'TON' | 'BALE';
  transportBy: TransportBy;
  transportCost: string;
  readyDate: string;
}
export type OfferFormErrors = Partial<Record<keyof OfferTermsForm | 'ack', string>>;

export function emptyTermsForm(kind: 'PURCHASE' | 'BALING_SERVICE' = 'PURCHASE'): OfferTermsForm {
  return { qty: '', qtyUnit: 'ton', price: '', priceUnit: kind === 'PURCHASE' ? 'TON' : 'BALE', transportBy: 'UNKNOWN', transportCost: '', readyDate: '' };
}
const clean = (s: string) => s.trim().replace(/,/g, '');
const AMOUNT = /^\d+(\.\d+)?$/;

/** Decimal string of kilograms from a user quantity in kg or ton (no floating point). */
export function qtyToKg(amount: string, unit: 'kg' | 'ton'): string | null {
  const s = clean(amount);
  if (!AMOUNT.test(s)) return null;
  const [i = '0', f = ''] = s.split('.');
  if (unit === 'kg') return f.length > 3 ? null : s;
  if (f.length > 6) return null;
  const milli = BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, '0'));
  // 1 millionth of a ton is 1 gram, i.e. one thousandth of a kg, so `milli` is already in thousandths of kg.
  return `${milli / 1000n}.${String(milli % 1000n).padStart(3, '0')}`;
}

export interface BuiltTerms {
  qtyKg: string;
  unitPriceThb: string | null;
  priceUnit: 'KG' | 'TON' | 'BALE' | null;
  transportBy: TransportBy;
  transportCostThb: string | null;
  readyDate: string | null;
}

export function buildTerms(f: OfferTermsForm): { terms: BuiltTerms; errors: OfferFormErrors } | { terms: null; errors: OfferFormErrors } {
  const errors: OfferFormErrors = {};
  const qtyKg = qtyToKg(f.qty, f.qtyUnit);
  if (qtyKg === null || Number(qtyKg) <= 0) errors.qty = 'กรอกปริมาณเป็นตัวเลขมากกว่า 0';
  const price = clean(f.price);
  if (price !== '' && (!AMOUNT.test(price) || (price.split('.')[1]?.length ?? 0) > 4)) errors.price = 'ราคาไม่ถูกต้อง';
  const cost = clean(f.transportCost);
  if (cost !== '' && (!AMOUNT.test(cost) || (cost.split('.')[1]?.length ?? 0) > 2)) errors.transportCost = 'ค่าขนส่งไม่ถูกต้อง';
  if (f.readyDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(f.readyDate)) errors.readyDate = 'วันที่ไม่ถูกต้อง';
  if (Object.keys(errors).length > 0 || qtyKg === null) return { terms: null, errors };
  return {
    errors,
    terms: {
      qtyKg,
      unitPriceThb: price === '' ? null : price,
      priceUnit: price === '' ? null : f.priceUnit,
      transportBy: f.transportBy,
      transportCostThb: cost === '' ? null : cost,
      readyDate: f.readyDate === '' ? null : f.readyDate,
    },
  };
}

/** Prefill an edit form from an existing offer. Quantity is shown in kg to avoid rounding. */
export function formFromOffer(o: OfferView): OfferTermsForm {
  return {
    qty: String(Number(o.qty_kg)),
    qtyUnit: 'kg',
    price: o.unit_price_thb === null ? '' : String(Number(o.unit_price_thb)),
    priceUnit: o.price_unit ?? (o.kind === 'PURCHASE' ? 'TON' : 'BALE'),
    transportBy: o.transport_by,
    transportCost: o.transport_cost_thb === null ? '' : String(Number(o.transport_cost_thb)),
    readyDate: o.ready_date ?? '',
  };
}

/** Maps API field paths to the form fields that show them. */
export function formErrorsFromPaths(paths: readonly string[]): OfferFormErrors {
  const map: Record<string, keyof OfferFormErrors> = {
    qtyKg: 'qty', unitPriceThb: 'price', priceUnit: 'price', transportCostThb: 'transportCost', readyDate: 'readyDate', ackPendingMaterial: 'ack',
  };
  const out: OfferFormErrors = {};
  for (const p of paths) {
    const k = map[p];
    if (k) out[k] = 'ข้อมูลไม่ถูกต้อง ตรวจสอบอีกครั้ง';
  }
  return out;
}

// ---- API calls ----------------------------------------------------------------------------------

export function newKey(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === 'function' ? c.randomUUID() : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createOffer(api: OffersApi, body: CreateOfferRequest, key: string) {
  return api.post('/offers', offerResultSchema, body, { 'Idempotency-Key': key });
}
export function editOffer(api: OffersApi, o: OfferView, changes: Record<string, unknown>, key: string) {
  return api.post(`/offers/${o.id}/edit`, offerResultSchema, { expectedVersion: o.version, changes }, { 'Idempotency-Key': key });
}
export function acceptOffer(api: OffersApi, o: OfferView, ack: boolean, key: string) {
  return api.post(`/offers/${o.id}/accept`, acceptOfferResultSchema, ack ? { ackPendingMaterial: true } : {}, { 'Idempotency-Key': key });
}
export function rejectOffer(api: OffersApi, o: OfferView, key: string) {
  return api.post(`/offers/${o.id}/reject`, offerResultSchema, { expectedVersion: o.version }, { 'Idempotency-Key': key });
}
export function withdrawOffer(api: OffersApi, o: OfferView, key: string) {
  return api.post(`/offers/${o.id}/withdraw`, offerResultSchema, { expectedVersion: o.version }, { 'Idempotency-Key': key });
}
export function createResaleDraft(api: OffersApi, agreementId: string): Promise<DraftView> {
  return api.post(`/agreements/${agreementId}/resale-draft`, draftViewSchema, {});
}
