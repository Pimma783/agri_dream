// Pure helpers and API calls for the resale pages (Requirement 14). No farmer identity is handled here:
// the source Agreement is shown as a short reference and a date only.
import {
  draftViewSchema,
  type AgreementView,
  type DraftView,
  type ListingView,
  type MaterialForm,
  type PriceMode,
} from '@agrimatch/contracts';
import type { ApiCore } from './api-core';
import { browserApi } from './api';
import { formatDecimal } from './format';
import { formatDate } from './format';
import { dayStart, NEGOTIABLE_LABEL } from './postings';
import { qtyToKg } from './offers';

export type ResaleApi = Pick<ApiCore, 'post' | 'patch'>;
export const defaultResaleApi: ResaleApi = browserApi;

export const PENDING_LABEL = 'รอรับ/รออัด';
export const NO_IMAGE_QUALITY_NOTICE =
  'ผลประเมินภาพของวัสดุก่อนอัด ไม่ใช่หลักฐานคุณภาพหลังอัด จึงไม่แสดงในประกาศขายต่อ';
export const SOURCE_NOTICE = 'แสดงเฉพาะรหัสและวันที่ของข้อตกลงต้นทาง ไม่แสดงข้อมูลของเกษตรกร';

export const DRAFT_STATUS_LABEL = { DRAFT: 'ร่าง (ข้อมูลไม่ครบ)', AWAITING_REVIEW: 'ร่าง (พร้อมตรวจ)', PUBLISHED: 'เผยแพร่แล้ว', CANCELLED: 'ยกเลิกแล้ว' } as const;

/** "8f3a21c0-..." -> "#8F3A21C0". The reference is an id, never a name. */
export function agreementRef(id: string | null | undefined): string {
  return id ? `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}` : '-';
}

export const isResaleDraft = (v: DraftView): boolean => v.draft.kind === 'RESALE_LISTING';
/** Drafts still being worked on. Published drafts show up as listings; cancelled ones are gone. */
export const openResaleDrafts = (list: readonly DraftView[]): DraftView[] =>
  list.filter((v) => isResaleDraft(v) && (v.draft.status === 'DRAFT' || v.draft.status === 'AWAITING_REVIEW'));
export const resaleListings = (list: readonly ListingView[]): ListingView[] => list.filter((l) => l.kind === 'RESALE');

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Pending-material status of a stored draft or a published listing field set. */
export function pendingOf(data: { pending_material?: unknown; expected_ready_at?: unknown }): { pending: boolean; expectedReadyAt: string | null } {
  return { pending: data.pending_material === true, expectedReadyAt: str(data.expected_ready_at) };
}
/** «รอรับ/รออัด» with the expected date, or a reminder that the date is still missing. */
export function pendingText(p: { pending: boolean; expectedReadyAt: string | null }): string | null {
  if (!p.pending) return null;
  return p.expectedReadyAt ? `${PENDING_LABEL} · คาดว่าพร้อม ${formatDate(p.expectedReadyAt)}` : `${PENDING_LABEL} · ยังไม่ระบุวันที่คาดว่าจะพร้อม`;
}

// ---- quantity arithmetic in thousandths of a kg (no floating point) -----------------------------
function toMilli(v: string): bigint {
  const [i = '0', f = ''] = v.split('.');
  return BigInt(i) * 1000n + BigInt(f.padEnd(3, '0').slice(0, 3));
}
const fromMilli = (m: bigint): string => `${(m < 0n ? 0n : m) / 1000n}.${String((m < 0n ? 0n : m) % 1000n).padStart(3, '0')}`;

/** Most this draft may list: what the agreement has not reserved for other drafts or listings. */
export function maxResaleKg(agreement: Pick<AgreementView, 'qty_kg' | 'resale_reserved_kg'>, draftQtyKg: string | null): string {
  return fromMilli(toMilli(agreement.qty_kg) - toMilli(agreement.resale_reserved_kg) + toMilli(draftQtyKg ?? '0'));
}
export const exceeds = (qtyKg: string, maxKg: string): boolean => toMilli(qtyKg) > toMilli(maxKg);

// ---- form ----------------------------------------------------------------------------------------
export interface ResaleFormState {
  qty: string;
  qtyUnit: 'kg' | 'ton';
  form: MaterialForm | '';
  priceMode: PriceMode | '';
  price: string;
  priceUnit: 'kg' | 'ton';
  province: string;
  district: string;
  pending: boolean;
  /** yyyy-mm-dd, Bangkok calendar day. */
  expectedReady: string;
}

/** Bangkok calendar day of a stored UTC instant. */
export function bangkokDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}
const plain = (v: unknown): string => {
  const s = str(v);
  return s === null ? '' : String(Number(s));
};

export function formFromDraft(d: DraftView['draft']['data']): ResaleFormState {
  const form = d.material_form === 'BALED' || d.material_form === 'LOOSE' ? d.material_form : '';
  const priceMode = d.price_mode === 'FIXED' || d.price_mode === 'NEGOTIABLE' ? d.price_mode : '';
  return {
    qty: plain(d.qty_kg),
    qtyUnit: 'kg',
    form,
    priceMode,
    price: plain(d.unit_price_thb),
    priceUnit: d.price_unit === 'KG' ? 'kg' : 'ton',
    province: str(d.province) ?? '',
    district: str(d.district) ?? '',
    pending: d.pending_material === true,
    expectedReady: str(d.expected_ready_at) ? bangkokDay(String(d.expected_ready_at)) : '',
  };
}

export type ResaleErrors = Record<string, string>;
export type ResalePatchResult = { ok: true; patch: Record<string, unknown> } | { ok: false; errors: ResaleErrors };

const PRICE_RE = /^\d{1,8}(\.\d{1,4})?$/;
const clean = (s: string) => s.trim().replace(/,/g, '');

/**
 * Form -> PATCH body. Only values that are present are sent: a missing field is reported by the preview
 * (`missing_fields`), not guessed. Invalid values and a quantity above the reservation block saving.
 */
export function buildResalePatch(f: ResaleFormState, maxKg: string): ResalePatchResult {
  const errors: ResaleErrors = {};
  const patch: Record<string, unknown> = { pending_material: f.pending };
  const qty = clean(f.qty);
  if (qty !== '') {
    const kg = qtyToKg(qty, f.qtyUnit);
    if (kg === null || toMilli(kg) <= 0n) errors.quantity = 'ปริมาณต้องเป็นตัวเลขมากกว่า 0';
    else if (exceeds(kg, maxKg)) errors.quantity = `ปริมาณเกินที่จองไว้ ขายต่อได้ไม่เกิน ${formatDecimal(maxKg)} กก.`;
    else patch.quantity = { value: qty, unit: f.qtyUnit };
  }
  if (f.form !== '') patch.material_form = f.form;
  if (f.priceMode === 'NEGOTIABLE') patch.price_mode = 'NEGOTIABLE'; // never a price of 0
  if (f.priceMode === 'FIXED') {
    patch.price_mode = 'FIXED';
    const p = clean(f.price);
    if (p !== '') {
      if (!PRICE_RE.test(p) || Number(p) <= 0) errors.price = 'ราคาต้องเป็นตัวเลขมากกว่า 0';
      else patch.price = { value: p, unit: f.priceUnit };
    }
  }
  if (f.province.trim()) patch.province = f.province.trim();
  if (f.district.trim()) patch.district = f.district.trim();
  if (f.pending && f.expectedReady !== '') patch.expected_ready_at = dayStart(f.expectedReady);
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, patch };
}

export function priceLabel(d: { price_mode?: unknown; unit_price_thb?: unknown; price_unit?: unknown }): string {
  if (d.price_mode !== 'FIXED') return d.price_mode === 'NEGOTIABLE' ? NEGOTIABLE_LABEL : 'ยังไม่ระบุ';
  const p = str(d.unit_price_thb);
  if (p === null || (d.price_unit !== 'KG' && d.price_unit !== 'TON')) return 'ยังไม่ระบุ';
  return `${Number(p).toLocaleString('th-TH', { maximumFractionDigits: 4 })} บาท/${d.price_unit === 'TON' ? 'ตัน' : 'กก.'}`;
}

// ---- API calls -----------------------------------------------------------------------------------
export function patchResaleDraft(api: ResaleApi, v: DraftView, patch: Record<string, unknown>): Promise<DraftView> {
  return api.patch(`/drafts/${v.draft.id}`, draftViewSchema, { expectedVersion: v.draft.version, patch });
}
/** Releases the reservation on the source agreement. */
export function cancelResaleDraft(api: ResaleApi, v: DraftView): Promise<DraftView> {
  return api.post(`/drafts/${v.draft.id}/cancel`, draftViewSchema, { expectedVersion: v.draft.version });
}
