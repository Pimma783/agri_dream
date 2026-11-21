// Display formatting. Dates always use Asia/Bangkok (Requirement 16 / design: Dashboard).
const TZ = 'Asia/Bangkok';
const dateTimeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const dateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, dateStyle: 'medium' });
const numberFmt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 });
const moneyFmt = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO UTC string -> Thai date and time in Asia/Bangkok. Invalid input gives "-". */
export function formatDateTime(iso: string): string {
  const d = toDate(iso);
  return d ? dateTimeFmt.format(d) : '-';
}

export function formatDate(iso: string): string {
  const d = toDate(iso);
  return d ? dateFmt.format(d) : '-';
}

/** Decimal string (kg) -> "5,000 กก." plus tons from 1,000 kg. The API stores kg only. */
export function formatKg(kg: string): string {
  const n = Number(kg);
  if (!Number.isFinite(n)) return '-';
  const base = `${numberFmt.format(n)} กก.`;
  return n >= 1000 ? `${base} (${numberFmt.format(n / 1000)} ตัน)` : base;
}

/** Decimal string THB amount, 2 decimals. */
export function formatThb(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? `${moneyFmt.format(n)} บาท` : '-';
}

/** Decimal string price per kg. */
export function formatThbPerKg(price: string): string {
  const n = Number(price);
  return Number.isFinite(n) ? `${moneyFmt.format(n)} บาท/กก.` : '-';
}
