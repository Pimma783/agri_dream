// Display formatting. Dates always use Asia/Bangkok (Requirement 16 / design: Dashboard).
const TZ = 'Asia/Bangkok';
const dateTimeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const dateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, dateStyle: 'medium' });
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

const DEC_RE = /^(-?)(\d+)(?:\.(\d+))?$/;
const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** Digit strings -> th-TH grouping, trailing zeros removed. String math only, no floats. */
function groupDecimal(sign: string, int: string, frac: string): string {
  const f = frac.replace(/0+$/, '');
  const i = int.replace(/^0+(?=\d)/, '');
  const neg = sign === '-' && (f !== '' || i !== '0');
  return `${neg ? '-' : ''}${group(i)}${f ? `.${f}` : ''}`;
}
/** Decimal string -> th-TH grouping, no trailing zeros ("1200.0000" -> "1,200"). Not a decimal gives "-". */
export function formatDecimal(v: string): string {
  const m = DEC_RE.exec(v.trim());
  return m ? groupDecimal(m[1] ?? '', m[2] ?? '0', m[3] ?? '') : '-';
}
/** Decimal string (kg) -> "5,000 กก." plus tons from 1,000 kg. The API stores kg only. */
export function formatKg(kg: string): string {
  const m = DEC_RE.exec(kg.trim());
  if (!m) return '-';
  const sign = m[1] ?? '';
  const int = (m[2] ?? '0').replace(/^0+(?=\d)/, '');
  const frac = m[3] ?? '';
  const base = `${groupDecimal(sign, int, frac)} กก.`;
  if (sign === '' && int.length >= 4) {
    // kg -> ton: move the decimal point three places left.
    return `${base} (${groupDecimal('', int.slice(0, -3), int.slice(-3) + frac)} ตัน)`;
  }
  return base;
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
