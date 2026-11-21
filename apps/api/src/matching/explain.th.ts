// Deterministic Thai renderer for reasons and flags (design.md "Explanations"). Pure.
// Text only cites numbers carried in `params`; unknown codes render a generic line, never invented facts.
import type { Flag, Reason } from './types.js';

/** Requirement 10.7: shown wherever scores appear. */
export const WEIGHTS_DISCLAIMER_TH =
  'น้ำหนักคะแนนเป็นค่าเริ่มต้นสำหรับทดสอบเดโม ไม่ใช่สูตรที่พิสูจน์ว่าดีที่สุด';

const MISSING_LABEL_TH: Readonly<Record<string, string>> = {
  distance: 'ระยะทาง',
  quantity: 'ปริมาณ',
  price: 'ราคา',
  time: 'ช่วงเวลา',
  conditions: 'เงื่อนไข',
  serviceArea: 'พื้นที่บริการ',
  materialForm: 'วัสดุและรูปแบบการอัด',
};

const p = (r: Reason, k: string): string => {
  const v = r.params[k];
  return v === null || v === undefined ? '-' : String(v);
};

export function renderReasonTh(r: Reason): string {
  switch (r.code) {
    case 'DISTANCE_KM':
      return `ระยะเส้นตรง ${p(r, 'km')} กม. (ไม่ใช่ระยะขับรถ)`;
    case 'QTY_COVERAGE':
      return `ปริมาณครอบคลุม ${p(r, 'coveragePct')}% (ฝั่งเสนอ ${p(r, 'supplyKg')} กก. ฝั่งรับ ${p(r, 'demandKg')} กก.)`;
    case 'PRICE_WITHIN_BUDGET':
      return `ราคา ${p(r, 'askThbPerKg')} บาท/กก. ไม่เกินงบ ${p(r, 'maxThbPerKg')} บาท/กก.`;
    case 'PRICE_ABOVE_BUDGET':
      return `ราคา ${p(r, 'askThbPerKg')} บาท/กก. สูงกว่างบ ${p(r, 'maxThbPerKg')} บาท/กก.`;
    case 'WINDOW_OVERLAP_DAYS':
      return `ช่วงเวลาซ้อนกัน ${p(r, 'days')} วัน`;
    default: {
      if (r.code.startsWith('MISSING_')) {
        const key = String(r.params.component ?? '');
        return `ไม่มีข้อมูล${MISSING_LABEL_TH[key] ?? ''} จึงไม่นำมาคิดคะแนน`;
      }
      return 'ไม่มีคำอธิบาย';
    }
  }
}

export function renderReasonsTh(reasons: readonly Reason[]): string[] {
  return reasons.map(renderReasonTh);
}

export function renderFlagTh(f: Flag): string {
  switch (f.code) {
    case 'NEEDS_CONFIRMATION':
      return `ต้องสอบถาม/ตรวจเพิ่ม: ${f.field}`;
    case 'INCOMPLETE':
      return 'ข้อมูลไม่ครบ';
    case 'PRICE_MISMATCH':
      return 'ราคาไม่ตรงกัน';
    case 'DISTANCE_UNVERIFIED':
      return 'ยังยืนยันระยะทางไม่ได้';
  }
}
