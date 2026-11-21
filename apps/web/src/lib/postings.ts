// Pure helpers for the demand and baling service forms: Thai labels, form state -> draft patch, display.
import {
  balingServicePatchSchema,
  purchaseDemandPatchSchema,
  type BalingService,
  type BalingServicePatch,
  type MaterialForm,
  type MaterialType,
  type PostingStatus,
  type PriceMode,
  type PurchaseDemand,
  type PurchaseDemandPatch,
  type ServiceMode,
  type TransportBy,
} from '@agrimatch/contracts';
import { formatDate, formatKg } from './format';

export const MATERIAL_LABEL: Record<MaterialType, string> = {
  RICE_STRAW: 'ฟางข้าว',
  CANE_LEAF: 'ใบอ้อย',
  CORN_COB: 'ซังข้าวโพด',
  OTHER: 'อื่น ๆ',
};
export const MATERIAL_OPTIONS: MaterialType[] = ['RICE_STRAW', 'CANE_LEAF', 'CORN_COB', 'OTHER'];
export const FORM_LABEL: Record<MaterialForm, string> = { LOOSE: 'ฟางหลวม', BALED: 'ฟางอัดก้อน' };
export const TRANSPORT_LABEL: Record<TransportBy, string> = {
  SELLER: 'ผู้ขายส่งให้',
  BUYER: 'ผู้ซื้อไปรับเอง',
  EITHER: 'ได้ทั้งสองแบบ',
  UNKNOWN: 'ยังไม่ระบุ',
};
export const SERVICE_MODE_LABEL: Record<ServiceMode, string> = {
  ON_SITE: 'อัดที่แปลง',
  AT_FACTORY: 'อัดที่โรงงาน',
  BOTH: 'ได้ทั้งสองแบบ',
};
export const PRICE_UNIT_LABEL = { kg: 'บาท/กก.', ton: 'บาท/ตัน', bale: 'บาท/ก้อน' } as const;
export const NEGOTIABLE_LABEL = 'ต่อรองได้';
export const OTHER_MATERIAL_NOTICE =
  'วัสดุ "อื่น ๆ" ยังไม่ถูกจับคู่อัตโนมัติ จนกว่าจะได้รับการตรวจยืนยัน';
export const VERIFY_LABEL = 'ต้องตรวจยืนยัน';

/** Quality conditions a buyer can set. Each may be flagged «ต้องตรวจยืนยัน» (stored as `<key>__verify`). */
export const QUALITY_FIELDS = [
  { key: 'moisture_max_pct', label: 'ความชื้นสูงสุด (%)', inputMode: 'decimal' },
  { key: 'contamination', label: 'สิ่งปนเปื้อนที่ยอมรับ', inputMode: 'text' },
  { key: 'bale_spec', label: 'ขนาดหรือน้ำหนักก้อน', inputMode: 'text' },
] as const;
export type QualityKey = (typeof QUALITY_FIELDS)[number]['key'];
export const verifyKey = (key: string): string => `${key}__verify`;

/** Thai names for canonical field keys returned in `missing_fields`. */
export const FIELD_LABEL: Record<string, string> = {
  accepted_materials: 'วัสดุที่รับ',
  accepted_forms: 'รูปแบบวัสดุ',
  target_qty_kg: 'ปริมาณที่ต้องการ',
  min_lot_kg: 'ปริมาณขั้นต่ำต่อรอบ',
  min_lot: 'ปริมาณขั้นต่ำต่อรอบ',
  price_mode: 'ราคา',
  price: 'ราคา',
  max_unit_price_thb: 'ราคา',
  unit_price_thb: 'ราคา',
  price_unit: 'หน่วยราคา',
  province: 'จังหวัด',
  district: 'อำเภอ',
  radius_km: 'รัศมีรับซื้อ',
  accepted_provinces: 'จังหวัดที่รับ',
  window_from: 'วันที่เริ่มรับ',
  window_to: 'วันที่สิ้นสุดรับ',
  quality: 'เงื่อนไขคุณภาพ',
  transport_by: 'การขนส่ง',
  material_types: 'วัสดุที่รับอัด',
  baling_format: 'รูปแบบก้อน',
  service_mode: 'รูปแบบบริการ',
  service_provinces: 'จังหวัดที่ให้บริการ',
  min_qty_kg: 'ปริมาณขั้นต่ำ',
  capacity_kg: 'กำลังอัดต่อรอบ',
  available_from: 'วันที่เริ่มให้บริการ',
  available_to: 'วันที่สิ้นสุดบริการ',
  lat: 'พิกัด',
  lng: 'พิกัด',
  qty_kg: 'ปริมาณขายต่อ',
  material_type: 'วัสดุ',
  material_form: 'รูปแบบก้อน',
  pending_material: 'สถานะรอรับ/รออัด',
  expected_ready_at: 'วันที่คาดว่าจะพร้อม',
};
export const fieldLabel = (key: string): string => FIELD_LABEL[key] ?? key;

// ---- form state -------------------------------------------------------------------------------
export interface QualityState {
  value: string;
  verify: boolean;
}
export interface DemandFormState {
  materials: MaterialType[];
  otherAcknowledged: boolean;
  forms: MaterialForm[];
  qty: string;
  qtyUnit: 'kg' | 'ton';
  minLot: string;
  minLotUnit: 'kg' | 'ton';
  priceMode: PriceMode | '';
  price: string;
  priceUnit: 'kg' | 'ton';
  province: string;
  district: string;
  radius: string;
  provinces: string[];
  from: string;
  to: string;
  quality: Record<QualityKey, QualityState>;
  transport: TransportBy | '';
  acceptsPending: boolean;
}
export const emptyQuality = (): Record<QualityKey, QualityState> => ({
  moisture_max_pct: { value: '', verify: false },
  contamination: { value: '', verify: false },
  bale_spec: { value: '', verify: false },
});
export const emptyDemandForm = (): DemandFormState => ({
  materials: [],
  otherAcknowledged: false,
  forms: [],
  qty: '',
  qtyUnit: 'ton',
  minLot: '',
  minLotUnit: 'ton',
  priceMode: '',
  price: '',
  priceUnit: 'ton',
  province: '',
  district: '',
  radius: '',
  provinces: [],
  from: '',
  to: '',
  quality: emptyQuality(),
  transport: '',
  acceptsPending: false,
});
export interface ServiceFormState {
  materials: MaterialType[];
  otherAcknowledged: boolean;
  balingFormat: string;
  mode: ServiceMode | '';
  provinces: string[];
  province: string;
  district: string;
  minQty: string;
  minQtyUnit: 'kg' | 'ton';
  capacity: string;
  capacityUnit: 'kg' | 'ton';
  priceMode: PriceMode | '';
  price: string;
  priceUnit: 'kg' | 'ton' | 'bale';
  transport: TransportBy | '';
  from: string;
  to: string;
}
export const emptyServiceForm = (): ServiceFormState => ({
  materials: [],
  otherAcknowledged: false,
  balingFormat: '',
  mode: '',
  provinces: [],
  province: '',
  district: '',
  minQty: '',
  minQtyUnit: 'ton',
  capacity: '',
  capacityUnit: 'ton',
  priceMode: '',
  price: '',
  priceUnit: 'bale',
  transport: '',
  from: '',
  to: '',
});

// ---- form state -> patch ----------------------------------------------------------------------
export type FormErrors = Record<string, string>;
export type BuildResult<P> = { ok: true; patch: P } | { ok: false; errors: FormErrors };

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const PRICE_RE = /^\d{1,8}(\.\d{1,4})?$/;
const RADIUS_RE = /^\d{1,4}(\.\d{1,2})?$/;
const isPositive = (s: string): boolean => Number(s) > 0;

/** Accepts "1,500" and Thai digits-free input; returns '' for empty. */
const clean = (s: string): string => s.trim().replace(/,/g, '');

export function parseList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,،、\n]/)) {
    const v = part.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
/** Bangkok-local start or end of a calendar day, as an offset ISO string the API normalizes to UTC. */
export const dayStart = (d: string): string => `${d}T00:00:00+07:00`;
export const dayEnd = (d: string): string => `${d}T23:59:59+07:00`;

function qty(raw: string, unit: 'kg' | 'ton', key: string, label: string, errors: FormErrors, required: boolean) {
  const v = clean(raw);
  if (v === '') {
    if (required) errors[key] = `กรอก${label}`;
    return undefined;
  }
  if (!QTY_RE.test(v) || !isPositive(v)) {
    errors[key] = `${label}ต้องเป็นตัวเลขมากกว่า 0`;
    return undefined;
  }
  return { value: v, unit };
}

function price<U extends string>(
  mode: PriceMode | '',
  raw: string,
  unit: U,
  errors: FormErrors,
): { price_mode?: PriceMode; price?: { value: string; unit: U } } {
  if (mode === '') {
    errors.price_mode = 'เลือกราคา';
    return {};
  }
  if (mode === 'NEGOTIABLE') return { price_mode: 'NEGOTIABLE' }; // never a price of 0
  const v = clean(raw);
  if (!PRICE_RE.test(v) || !isPositive(v)) {
    errors.price = 'กรอกราคามากกว่า 0 หรือเลือก "ต่อรองได้"';
    return { price_mode: 'FIXED' };
  }
  return { price_mode: 'FIXED', price: { value: v, unit } };
}

function materialsError(materials: MaterialType[], acknowledged: boolean, errors: FormErrors) {
  if (materials.length === 0) errors.materials = 'เลือกวัสดุอย่างน้อย 1 อย่าง';
  else if (materials.includes('OTHER') && !acknowledged) errors.materials = 'ยืนยันเงื่อนไขของวัสดุ "อื่น ๆ" ก่อน';
}

export function buildDemandPatch(f: DemandFormState): BuildResult<PurchaseDemandPatch> {
  const errors: FormErrors = {};
  materialsError(f.materials, f.otherAcknowledged, errors);
  const target = qty(f.qty, f.qtyUnit, 'target_quantity', 'ปริมาณที่ต้องการ', errors, true);
  const minLot = qty(f.minLot, f.minLotUnit, 'min_lot', 'ปริมาณขั้นต่ำ', errors, false);
  const p = price(f.priceMode, f.price, f.priceUnit, errors);
  const province = f.province.trim();
  if (!province) errors.province = 'เลือกจังหวัด';
  const radius = clean(f.radius);
  if (radius !== '' && (!RADIUS_RE.test(radius) || !isPositive(radius) || Number(radius) > 80)) errors.radius_km = 'เลือกรัศมี 10 ถึง 80 กม.';
  const accepted = [...new Set(f.provinces)];
  if (accepted.length > 10) errors.accepted_provinces = 'ระบุได้ไม่เกิน 10 จังหวัด';
  if (f.from && f.to && f.to < f.from) errors.window_to = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
  if (f.transport === '') errors.transport_by = 'เลือกผู้รับผิดชอบการขนส่ง';
  const quality: Record<string, string | boolean> = {};
  for (const q of QUALITY_FIELDS) {
    const s = f.quality[q.key];
    const v = s.value.trim();
    if (v === '') {
      if (s.verify) errors[`quality.${q.key}`] = 'กรอกค่าก่อนติ๊ก "ต้องตรวจยืนยัน"';
      continue;
    }
    quality[q.key] = v;
    if (s.verify) quality[verifyKey(q.key)] = true;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const patch: PurchaseDemandPatch = {
    accepted_materials: f.materials,
    ...(f.forms.length ? { accepted_forms: f.forms } : {}),
    ...(target ? { target_quantity: target } : {}),
    ...(minLot ? { min_lot: minLot } : {}),
    ...p,
    province,
    ...(f.district.trim() ? { district: f.district.trim() } : {}),
    ...(radius ? { radius_km: radius } : {}),
    ...(accepted.length ? { accepted_provinces: accepted } : {}),
    ...(f.from ? { window_from: dayStart(f.from) } : {}),
    ...(f.to ? { window_to: dayEnd(f.to) } : {}),
    ...(Object.keys(quality).length ? { quality } : {}),
    ...(f.transport !== '' ? { transport_by: f.transport } : {}),
    accepts_pending_material: f.acceptsPending,
  };
  const parsed = purchaseDemandPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, errors: { form: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจอีกครั้ง' } };
  return { ok: true, patch: parsed.data };
}

export function buildServicePatch(f: ServiceFormState): BuildResult<BalingServicePatch> {
  const errors: FormErrors = {};
  materialsError(f.materials, f.otherAcknowledged, errors);
  if (f.mode === '') errors.service_mode = 'เลือกรูปแบบบริการ';
  const minQty = qty(f.minQty, f.minQtyUnit, 'min_quantity', 'ปริมาณขั้นต่ำ', errors, false);
  const capacity = qty(f.capacity, f.capacityUnit, 'capacity', 'กำลังอัดต่อรอบ', errors, false);
  const p = price(f.priceMode, f.price, f.priceUnit, errors);
  const province = f.province.trim();
  if (!province) errors.province = 'เลือกจังหวัด';
  const provinces = [...new Set(f.provinces)];
  if (provinces.length > 10) errors.service_provinces = 'ระบุได้ไม่เกิน 10 จังหวัด';
  if (f.from && f.to && f.to < f.from) errors.available_to = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
  if (f.transport === '') errors.transport_by = 'เลือกผู้รับผิดชอบการขนส่ง';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const patch: BalingServicePatch = {
    material_types: f.materials,
    ...(f.balingFormat.trim() ? { baling_format: f.balingFormat.trim() } : {}),
    ...(f.mode !== '' ? { service_mode: f.mode } : {}),
    ...(provinces.length ? { service_provinces: provinces } : {}),
    province,
    ...(f.district.trim() ? { district: f.district.trim() } : {}),
    ...(minQty ? { min_quantity: minQty } : {}),
    ...(capacity ? { capacity } : {}),
    ...p,
    ...(f.transport !== '' ? { transport_by: f.transport } : {}),
    ...(f.from ? { available_from: dayStart(f.from) } : {}),
    ...(f.to ? { available_to: dayEnd(f.to) } : {}),
  };
  const parsed = balingServicePatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, errors: { form: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจอีกครั้ง' } };
  return { ok: true, patch: parsed.data };
}

// ---- display ----------------------------------------------------------------------------------
const STORED_UNIT_LABEL = { KG: 'บาท/กก.', TON: 'บาท/ตัน', BALE: 'บาท/ก้อน' } as const;
const priceFmt = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

/** NEGOTIABLE (stored as no price) shows «ต่อรองได้», never 0. */
export function formatPostingPrice(
  mode: PriceMode,
  amount: string | null,
  unit: keyof typeof STORED_UNIT_LABEL | null,
): string {
  if (mode === 'NEGOTIABLE' || amount === null || unit === null) return NEGOTIABLE_LABEL;
  const n = Number(amount);
  return Number.isFinite(n) ? `${priceFmt.format(n)} ${STORED_UNIT_LABEL[unit]}` : NEGOTIABLE_LABEL;
}

export const materialsText = (m: readonly MaterialType[]): string => m.map((x) => MATERIAL_LABEL[x]).join(', ') || '-';

export function windowText(from: string | null, to: string | null): string {
  if (!from && !to) return 'ไม่ระบุ';
  return `${from ? formatDate(from) : '...'} - ${to ? formatDate(to) : '...'}`;
}

export interface QualityLine {
  label: string;
  value: string;
  needsVerify: boolean;
}
export function qualityLines(quality: Record<string, unknown>): QualityLine[] {
  const known = new Map<string, string>(QUALITY_FIELDS.map((q) => [q.key, q.label]));
  const lines: QualityLine[] = [];
  for (const [key, value] of Object.entries(quality)) {
    if (key.endsWith('__verify') || value === undefined || value === null) continue;
    lines.push({ label: known.get(key) ?? key, value: String(value), needsVerify: quality[verifyKey(key)] === true });
  }
  return lines;
}

export const POSTING_STATUS_ACTIONS: Record<PostingStatus, readonly ('pause' | 'open' | 'close' | 'cancel')[]> = {
  PUBLISHED: ['pause', 'close', 'cancel'],
  PAUSED: ['open', 'close', 'cancel'],
  CLOSED: [],
  CANCELLED: [],
};
export const ACTION_LABEL = { pause: 'พักประกาศ', open: 'เปิดประกาศ', close: 'ปิดประกาศ', cancel: 'ยกเลิกประกาศ' } as const;
export const ACTION_DONE_LABEL = { pause: 'พักประกาศแล้ว', open: 'เปิดประกาศแล้ว', close: 'ปิดประกาศแล้ว', cancel: 'ยกเลิกประกาศแล้ว' } as const;

export function demandSummary(d: PurchaseDemand): { target: string; remaining: string; price: string } {
  return {
    target: formatKg(d.target_qty_kg),
    remaining: formatKg(d.remaining_qty_kg),
    price: formatPostingPrice(d.price_mode, d.max_unit_price_thb, d.price_unit),
  };
}
export function serviceSummary(s: BalingService): { price: string; capacity: string } {
  return {
    price: formatPostingPrice(s.price_mode, s.unit_price_thb, s.price_unit),
    capacity: s.capacity_kg ? formatKg(s.capacity_kg) : 'ไม่ระบุ',
  };
}
