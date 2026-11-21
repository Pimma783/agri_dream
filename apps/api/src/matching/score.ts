// Scoring, ranking and reasons for the matching engine (design.md "Matching engine", Requirements 9.7, 9.9, 10).
// Pure: no clock, no randomness, no I/O. The caller passes inputs and the rule config.
//
// - Components are in [0,1], rounded half up to 4 dp. `null` means unknown and is never counted as 0.
// - total = 100 * sum(w*v over known) / sum(w over known), rounded half up to 2 dp.
// - Nothing is invented: a component without data on both sides is unknown (Requirement 9.9).
import { D, KG_PER_TON, type Dec } from '../domain/units.js';
import { provinceIn } from '../domain/step-parsers.js';
import { filterPair, type FilterOutcome } from './filter.js';
import {
  SERVICE_COMPONENT_KEYS,
  TRADE_COMPONENT_KEYS,
  type ComponentKey,
  type ComponentScore,
  type DemandSubject,
  type Flag,
  type MatchInput,
  type MatchResult,
  type Price,
  type Reason,
  type Route,
  type RuleConfig,
  type SupplySubject,
  type TimeWindow,
} from './types.js';

const DAY_MS = 86_400_000;
const ZERO = new D(0);
const ONE = new D(1);

const clamp01 = (v: Dec): Dec => (v.lessThan(ZERO) ? ZERO : v.greaterThan(ONE) ? ONE : v);
const round4 = (v: Dec): Dec => clamp01(v).toDecimalPlaces(4, D.ROUND_HALF_UP);

/** Price in THB per kg, or null when negotiable, missing, non-positive or not convertible (Requirement 10.8). */
function priceThbPerKg(p: Price | null): Dec | null {
  if (p === null || p.negotiable || p.amount === null || p.unit === null) return null;
  if (!p.amount.isFinite() || p.amount.isNegative()) return null;
  const amount = new D(p.amount);
  if (p.unit === 'THB_PER_KG') return amount;
  if (p.unit === 'THB_PER_TON') return amount.div(KG_PER_TON);
  return null; // per bale: bale weight is unknown, never guessed
}

interface TimeInfo {
  readonly value: Dec;
  readonly overlapDays: Dec;
}

function timeOverlap(a: TimeWindow | null, b: TimeWindow | null): TimeInfo | null {
  if (a === null || b === null) return null;
  const start = Math.max(a.from.getTime(), b.from.getTime());
  const end = Math.min(a.to.getTime(), b.to.getTime());
  const overlapMs = Math.max(0, end - start);
  const shorterMs = Math.min(a.to.getTime() - a.from.getTime(), b.to.getTime() - b.from.getTime());
  const shorterDays = D.max(new D(shorterMs).div(DAY_MS), ONE);
  const overlapDays = new D(overlapMs).div(DAY_MS);
  return { value: overlapDays.div(shorterDays), overlapDays };
}

/** Ask vs maximum, both THB/kg. Equal or below = 1; above decays linearly to 0 at twice the maximum. */
function priceFit(ask: Dec, max: Dec): Dec {
  if (ask.lessThanOrEqualTo(max)) return ONE;
  if (max.isZero()) return ZERO;
  return D.max(ZERO, ONE.minus(ask.minus(max).div(max)));
}

interface Scored {
  readonly values: Partial<Record<ComponentKey, Dec | null>>;
  readonly reasons: Reason[];
  readonly flags: Flag[];
}

const fixed = (v: Dec, dp: number): string => v.toFixed(dp, D.ROUND_HALF_UP);

function pushPriceReason(reasons: Reason[], flags: Flag[], ask: Dec | null, max: Dec | null): Dec | null {
  if (ask === null || max === null) return null;
  const fit = priceFit(ask, max);
  const within = ask.lessThanOrEqualTo(max);
  reasons.push({
    code: within ? 'PRICE_WITHIN_BUDGET' : 'PRICE_ABOVE_BUDGET',
    params: { askThbPerKg: fixed(ask, 4), maxThbPerKg: fixed(max, 4) },
  });
  if (!within) flags.push({ code: 'PRICE_MISMATCH' });
  return fit;
}

function tradeComponents(supply: SupplySubject, demand: DemandSubject, f: FilterOutcome, cfg: RuleConfig): Scored {
  const reasons: Reason[] = [];
  const flags: Flag[] = [];
  const values: Partial<Record<ComponentKey, Dec | null>> = {};

  // distance
  if (f.distanceExactKm !== null) {
    const cap = Math.min(cfg.maxTransportKm, demand.radiusKm ?? cfg.maxTransportKm);
    values.distance = cap > 0 ? ONE.minus(new D(f.distanceExactKm).div(cap)) : f.distanceExactKm <= 0 ? ONE : ZERO;
    reasons.push({ code: 'DISTANCE_KM', params: { km: f.distanceKm, kind: 'straight_line' } });
  } else values.distance = null;

  // quantity: share of the seller's lot this buyer can absorb
  const l = supply.remainingKg;
  const dem = demand.remainingKg;
  if (l.isFinite() && l.greaterThan(0) && dem.isFinite() && dem.greaterThan(0)) {
    const L = new D(l);
    const cover = D.min(L, new D(dem)).div(L);
    values.quantity = cover;
    reasons.push({
      code: 'QTY_COVERAGE',
      params: { supplyKg: fixed(L, 3), demandKg: fixed(new D(dem), 3), coveragePct: fixed(cover.times(100), 1) },
    });
  } else values.quantity = null;

  // price: supplier asks, buyer pays at most
  values.price = pushPriceReason(reasons, flags, priceThbPerKg(supply.price), priceThbPerKg(demand.price));

  // time
  const t = timeOverlap(supply.window, demand.window);
  values.time = t === null ? null : t.value;
  if (t !== null) reasons.push({ code: 'WINDOW_OVERLAP_DAYS', params: { days: fixed(t.overlapDays, 1) } });

  // conditions: only decidable checks, pass / (pass + fail)
  let pass = 0;
  let fail = 0;
  const check = (ok: boolean): void => {
    if (ok) pass += 1;
    else fail += 1;
  };
  if (supply.transport && demand.transport) {
    check(supply.transport === 'EITHER' || demand.transport === 'EITHER' || supply.transport === demand.transport);
  }
  if (supply.moisturePct && demand.maxMoisturePct && supply.moisturePct.isFinite() && demand.maxMoisturePct.isFinite()) {
    check(supply.moisturePct.lessThanOrEqualTo(demand.maxMoisturePct));
  }
  values.conditions = pass + fail === 0 ? null : new D(pass).div(pass + fail);

  return { values, reasons, flags };
}

function serviceComponents(request: SupplySubject, service: DemandSubject, f: FilterOutcome): Scored {
  const reasons: Reason[] = [];
  const flags: Flag[] = [];
  const values: Partial<Record<ComponentKey, Dec | null>> = {};

  if (f.distanceExactKm !== null) {
    reasons.push({ code: 'DISTANCE_KM', params: { km: f.distanceKm, kind: 'straight_line' } });
  }

  // service area: same decision order as the filter (coordinates with radius, else province list)
  if (f.distanceExactKm !== null && service.radiusKm !== null) {
    values.serviceArea =
      service.radiusKm > 0 ? ONE.minus(new D(f.distanceExactKm).div(service.radiusKm)) : f.distanceExactKm <= 0 ? ONE : ZERO;
  } else if (service.provinces.length > 0 && request.province !== null) {
    values.serviceArea = provinceIn(service.provinces, request.province) ? ONE : ZERO;
  } else values.serviceArea = null;

  // material and form: fraction of satisfied preferences (material is already equal after the filter)
  let met = 0;
  let total = 0;
  const modes = service.balingModes ?? [];
  if (request.balingMode && modes.length > 0) {
    total += 1;
    if (modes.includes(request.balingMode)) met += 1;
  }
  const formats = service.baleFormats ?? [];
  if (request.baleFormat && formats.length > 0) {
    total += 1;
    if (formats.includes(request.baleFormat)) met += 1;
  }
  values.materialForm = total === 0 ? null : new D(met).div(total);

  // time
  const t = timeOverlap(request.window, service.window);
  values.time = t === null ? null : t.value;
  if (t !== null) reasons.push({ code: 'WINDOW_OVERLAP_DAYS', params: { days: fixed(t.overlapDays, 1) } });

  // quantity: min(1, capacity / R)
  const cap = service.capacityKg ?? null;
  const req = request.remainingKg;
  if (cap !== null && cap.isFinite() && !cap.isNegative() && req.isFinite() && req.greaterThan(0)) {
    const cover = D.min(ONE, new D(cap).div(new D(req)));
    values.quantity = cover;
    reasons.push({
      code: 'QTY_COVERAGE',
      params: { supplyKg: fixed(new D(req), 3), demandKg: fixed(new D(cap), 3), coveragePct: fixed(cover.times(100), 1) },
    });
  } else values.quantity = null;

  // price: request budget (max) vs service price (ask); per-bale and negotiable are unknown
  values.price = pushPriceReason(reasons, flags, priceThbPerKg(service.price), priceThbPerKg(request.price));

  return { values, reasons, flags };
}

/** Fixed order of reasons: distance, quantity, price, window, then MISSING_* in component order. */
const REASON_ORDER: readonly Reason['code'][] = [
  'DISTANCE_KM',
  'QTY_COVERAGE',
  'PRICE_WITHIN_BUDGET',
  'PRICE_ABOVE_BUDGET',
  'WINDOW_OVERLAP_DAYS',
];

const missingCode = (key: ComponentKey): Reason['code'] =>
  `MISSING_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;

/** Score one pair that passed the filter. The route selects the weights and the components. */
export function scorePair(
  route: Route,
  supply: SupplySubject,
  demand: DemandSubject,
  cfg: RuleConfig,
  filtered: FilterOutcome = filterPair(route, supply, demand, cfg),
): MatchResult {
  const isService = route === 3;
  const keys: readonly ComponentKey[] = isService ? SERVICE_COMPONENT_KEYS : TRADE_COMPONENT_KEYS;
  const weights = (isService ? cfg.service : cfg.trade) as Readonly<Record<string, string>>;
  const scored = isService ? serviceComponents(supply, demand, filtered) : tradeComponents(supply, demand, filtered, cfg);

  const components: Partial<Record<ComponentKey, ComponentScore>> = {};
  let weighted = ZERO;
  let coverage = ZERO;
  const missing: Reason[] = [];
  for (const key of keys) {
    const w = new D(weights[key] ?? '0');
    const raw = scored.values[key] ?? null;
    const v = raw === null ? null : round4(raw);
    components[key] = { value: v === null ? null : v.toFixed(4), weight: weights[key] ?? '0' };
    if (v === null) {
      missing.push({ code: missingCode(key), params: { component: key } });
    } else {
      weighted = weighted.plus(w.times(v));
      coverage = coverage.plus(w);
    }
  }

  const known = coverage.greaterThan(0);
  const score = known ? weighted.div(coverage).times(100).toDecimalPlaces(2, D.ROUND_HALF_UP) : ZERO;

  const flags: Flag[] = [...filtered.flags, ...scored.flags];
  const incomplete = !known || coverage.lessThan(ONE);
  if (incomplete) flags.push({ code: 'INCOMPLETE' });

  const reasons = [
    ...REASON_ORDER.flatMap((code) => scored.reasons.filter((r) => r.code === code)),
    ...missing,
  ];

  const needsConfirm = flags.some((x) => x.code === 'NEEDS_CONFIRMATION' || x.code === 'DISTANCE_UNVERIFIED');
  return {
    route,
    supplyId: supply.id,
    demandId: demand.id,
    ruleVersion: cfg.version,
    score: score.toFixed(2),
    components,
    weightCoverage: coverage.toFixed(4),
    flags,
    distanceKm: filtered.distanceKm,
    distanceKind: filtered.distanceKind,
    reasons,
    tier: needsConfirm || incomplete ? 1 : 0,
  };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sort by (tier asc, score desc, supplyId asc, demandId asc). Returns a new array. */
export function rankMatches(results: readonly MatchResult[]): MatchResult[] {
  return [...results].sort(
    (a, b) =>
      a.tier - b.tier ||
      new D(b.score).comparedTo(new D(a.score)) ||
      cmp(a.supplyId, b.supplyId) ||
      cmp(a.demandId, b.demandId),
  );
}

/** Filter, score and rank every supply x demand pair. Excluded pairs are omitted. */
export function runMatching(input: MatchInput): MatchResult[] {
  const out: MatchResult[] = [];
  for (const s of input.supplies) {
    for (const d of input.demands) {
      const f = filterPair(input.route, s, d, input.config);
      if (f.excluded.length === 0) out.push(scorePair(input.route, s, d, input.config, f));
    }
  }
  return rankMatches(out);
}
