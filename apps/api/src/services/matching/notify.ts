// Layer: services. Builds the Dashboard "new match" notification text (task 23.1).
// Only published fields of the supply side are used: material, quantity and province. No farmer identity or contact data.
const MATERIAL_TH: Readonly<Record<string, string>> = {
  RICE_STRAW: 'ฟางข้าว', CANE_LEAF: 'ใบอ้อย', CORN_COB: 'ซังข้าวโพด', OTHER: 'อื่นๆ',
};

/** Decimal string (kg) -> "5,000 กก." with th-TH grouping. String math only, no floats. */
export function formatKgTh(kg: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(kg.trim());
  if (!m) return '';
  const int = (m[1] ?? '0').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (m[2] ?? '').replace(/0+$/, '');
  return `${int}${frac ? `.${frac}` : ''} กก.`;
}

export interface SupplySummary {
  materialType: string;
  qtyKg: string;
  province: string | null;
}

export function newMatchNotificationText(route: number, s: SupplySummary): { title_th: string; body_th: string } {
  const parts = [MATERIAL_TH[s.materialType] ?? 'วัสดุเหลือใช้ทางการเกษตร', formatKgTh(s.qtyKg)].filter((p) => p !== '');
  const body = [parts.join(' '), s.province].filter((p): p is string => typeof p === 'string' && p !== '').join(' · ');
  return {
    title_th: route === 3 ? 'มีคำขอใหม่ตรงกับบริการของคุณ' : 'มีประกาศใหม่ตรงกับความต้องการของคุณ',
    body_th: body,
  };
}
