// Pure helpers for the factory portal: kg-based API values -> tons and baht, month buckets in Asia/Bangkok.
import type { AgreementView, MatchView } from '@agrimatch/contracts';
import { MATERIAL_LABEL } from './postings';

export const tonOf = (kg: string): number => {
  const n = Number(kg);
  return Number.isFinite(n) ? n / 1000 : 0;
};
export const fmtNum = (n: number, digits = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtBaht = (n: number): string => `฿${fmtNum(n)}`;
export const agreementCode = (id: string): string => `AGR-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
export const isLive = (a: AgreementView): boolean => a.status !== 'CANCELLED';
export const valueOf = (a: AgreementView): number => (a.total_amount_thb ? Number(a.total_amount_thb) || 0 : 0);

const monthFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', month: 'short' });
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' });

/** Last `n` months (oldest first) with the total of `pick(a)` per month. */
export function monthly(items: readonly AgreementView[], pick: (a: AgreementView) => number, n = 6) {
  const now = new Date();
  const months = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 15));
    return { key: keyFmt.format(d), label: monthFmt.format(d), total: 0 };
  });
  for (const a of items) {
    const m = months.find((x) => x.key === keyFmt.format(new Date(a.confirmed_at)));
    if (m) m.total += pick(a);
  }
  return { labels: months.map((m) => m.label), values: months.map((m) => Math.round(m.total * 10) / 10) };
}

export function summarize(items: readonly AgreementView[], orgId: string) {
  const live = items.filter(isLive);
  const bought = live.filter((a) => a.buyer_org_id === orgId);
  const sold = live.filter((a) => a.seller_org_id === orgId);
  const sum = (xs: readonly AgreementView[], f: (a: AgreementView) => number) => xs.reduce((s, a) => s + f(a), 0);
  return {
    live, bought, sold,
    boughtTon: sum(bought, (a) => tonOf(a.qty_kg)),
    soldTon: sum(sold, (a) => tonOf(a.qty_kg)),
    boughtValue: sum(bought, valueOf),
    totalValue: sum(live, valueOf),
  };
}

/** Marketplace card fields taken from a match's published counterparty data. */
export function matchCard(m: MatchView) {
  const p = m.counterparty.published as Record<string, unknown>;
  const mats = (Array.isArray(p.accepted_materials) ? p.accepted_materials : [p.material_type]).filter(
    (x): x is keyof typeof MATERIAL_LABEL => typeof x === 'string' && x in MATERIAL_LABEL,
  );
  const remaining = typeof p.remaining_qty_kg === 'string' ? tonOf(p.remaining_qty_kg) : null;
  return {
    title: mats.map((x) => MATERIAL_LABEL[x]).join(', ') || 'วัสดุเกษตร',
    seller: m.counterparty.display_name ?? 'ไม่ระบุชื่อ',
    province: m.counterparty.province ?? '-',
    remainingTon: remaining,
  };
}
