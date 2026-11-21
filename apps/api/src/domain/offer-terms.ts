// Pure offer pricing (Requirements 11.1, 11.2). The total is quantity x price and never includes transport.
import { D, KG_PER_TON, TOTAL_SCALE, parseDecimal } from './units.js';

export type OfferPriceUnit = 'KG' | 'TON' | 'BALE';

/**
 * Total in THB rounded half up to 2 places, or null when it cannot be computed:
 * no price, no unit, or a per-bale price (the weight of a bale is never guessed).
 * Transport cost is deliberately not a parameter, so it cannot leak into the total.
 */
export function computeOfferTotal(
  qtyKg: string,
  unitPriceThb: string | null | undefined,
  priceUnit: OfferPriceUnit | null | undefined,
): string | null {
  if (unitPriceThb === null || unitPriceThb === undefined || priceUnit === null || priceUnit === undefined) return null;
  if (priceUnit === 'BALE') return null;
  const qty = parseDecimal(qtyKg);
  const price = parseDecimal(unitPriceThb);
  if (qty === null || price === null || qty.isNegative() || price.isNegative()) return null;
  const amount = priceUnit === 'TON' ? qty.div(KG_PER_TON).mul(price) : qty.mul(price);
  return new D(amount).toDecimalPlaces(TOTAL_SCALE, D.ROUND_HALF_UP).toFixed(TOTAL_SCALE);
}
