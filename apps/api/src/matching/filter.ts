// Filter stage of the matching engine (design.md "Matching engine", Requirement 9). Pure.
//
// Rules:
// - A known violation adds an exclusion code. Codes are always returned in EXCLUSION_CODES order.
// - Missing input never excludes. It adds a NEEDS_CONFIRMATION(field) flag (or DISTANCE_UNVERIFIED)
//   and the pair is tier 1. Nothing here claims that an unknown condition passed.
// - Distance is straight-line (Haversine). It is only known when both sides have valid coordinates.
// - OVER_RADIUS (buyer radius_km) and OVER_MAX_TRANSPORT (config cap) apply to routes 1, 2 and 4.
//   Route 3 uses the service area of the baling service instead (AREA_MISMATCH).
// - The caller assigns the route from the owner roles and listing kind; this stage does not re-derive it.
// - Tier here only reflects flags. Scoring (task 3.3) also lowers confidence when weightCoverage < 1.
import { D, type Dec } from '../domain/units.js';
import { provinceIn as inProvinces } from '../domain/step-parsers.js';
import { haversineKm, isValidCoordinates } from '../domain/distance.js';
import {
  EXCLUSION_CODES,
  type DemandSubject,
  type ExclusionCode,
  type Flag,
  type GeoPoint,
  type MatchInput,
  type Route,
  type RuleConfig,
  type SupplySubject,
  type TimeWindow,
} from './types.js';

export interface FilterOutcome {
  readonly route: Route;
  readonly supplyId: string;
  readonly demandId: string;
  /** Empty when the pair passes. Always in EXCLUSION_CODES order, without duplicates. */
  readonly excluded: ExclusionCode[];
  readonly flags: Flag[];
  /** Straight-line km, 2 dp, or null when either side lacks valid coordinates. */
  readonly distanceKm: string | null;
  readonly distanceKind: 'straight_line' | null;
  /** Unrounded distance for the scoring stage; null when unknown. */
  readonly distanceExactKm: number | null;
  /** 0 = no flags; 1 = something needs confirmation. */
  readonly tier: 0 | 1;
}

const validPoint = (p: GeoPoint | null): p is GeoPoint => p !== null && isValidCoordinates(p);

function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.from.getTime() <= b.to.getTime() && b.from.getTime() <= a.to.getTime();
}

const positive = (d: Dec): boolean => d.isFinite() && d.greaterThan(0);

export function filterPair(
  route: Route,
  supply: SupplySubject,
  demand: DemandSubject,
  config: RuleConfig,
): FilterOutcome {
  const hit = new Set<ExclusionCode>();
  const flags: Flag[] = [];
  const needs = (field: string): void => {
    flags.push({ code: 'NEEDS_CONFIRMATION', field });
  };

  // Distance
  let exact: number | null = null;
  if (validPoint(supply.location) && validPoint(demand.location)) {
    exact = haversineKm(supply.location, demand.location);
  }
  const distanceKm = exact === null ? null : new D(exact).toFixed(2, D.ROUND_HALF_UP);

  // 1-3 NOT_PUBLISHED, NO_REMAINING, SAME_ORG
  if (!supply.published || !demand.published) hit.add('NOT_PUBLISHED');
  if (!positive(supply.remainingKg) || !positive(demand.remainingKg)) hit.add('NO_REMAINING');
  if (supply.orgId === demand.orgId) hit.add('SAME_ORG');

  // 4 MATERIAL_MISMATCH: an unconfirmed OTHER material never matches
  if (supply.material === 'OTHER' || demand.material === 'OTHER' || supply.material !== demand.material) {
    hit.add('MATERIAL_MISMATCH');
  }

  // 5 FORM_MISMATCH (route 3 scores form preferences instead of filtering on them)
  if (route !== 3) {
    if (supply.form === null || demand.forms.length === 0) needs('form');
    else if (!demand.forms.includes(supply.form)) hit.add('FORM_MISMATCH');
  }

  // 6 BELOW_MIN_LOT: supply remaining must reach the demand's minimum lot
  if (demand.minLotKg !== null && supply.remainingKg.lessThan(demand.minLotKg)) hit.add('BELOW_MIN_LOT');

  // 7 WINDOW_NO_OVERLAP
  if (supply.window === null || demand.window === null) needs('window');
  else if (!windowsOverlap(supply.window, demand.window)) hit.add('WINDOW_NO_OVERLAP');

  // 8 AREA_MISMATCH
  if (route === 3) {
    // Service area: coordinates with a service radius when decidable, otherwise the province list.
    if (exact !== null && demand.radiusKm !== null) {
      if (exact > demand.radiusKm) hit.add('AREA_MISMATCH');
    } else if (demand.provinces.length > 0 && supply.province !== null) {
      if (!inProvinces(demand.provinces, supply.province)) hit.add('AREA_MISMATCH');
    } else {
      needs('area');
    }
  } else if (demand.provinces.length > 0) {
    if (supply.province === null) needs('area');
    else if (!inProvinces(demand.provinces, supply.province)) hit.add('AREA_MISMATCH');
  }

  // 9-10 OVER_RADIUS and OVER_MAX_TRANSPORT (routes 1, 2, 4; only with coordinates on both sides)
  if (route !== 3 && exact !== null) {
    if (demand.radiusKm !== null && exact > demand.radiusKm) hit.add('OVER_RADIUS');
    if (exact > config.maxTransportKm) hit.add('OVER_MAX_TRANSPORT');
  }

  if (exact === null) flags.push({ code: 'DISTANCE_UNVERIFIED' });

  return {
    route,
    supplyId: supply.id,
    demandId: demand.id,
    excluded: EXCLUSION_CODES.filter((c) => hit.has(c)),
    flags,
    distanceKm,
    distanceKind: exact === null ? null : 'straight_line',
    distanceExactKm: exact,
    tier: flags.length > 0 ? 1 : 0,
  };
}

/** Evaluate every supply x demand pair. Includes excluded pairs, with their codes. Order: supplies, then demands. */
export function filterOnly(input: MatchInput): FilterOutcome[] {
  const out: FilterOutcome[] = [];
  for (const s of input.supplies) {
    for (const d of input.demands) out.push(filterPair(input.route, s, d, input.config));
  }
  return out;
}

/** Pairs that pass the filter (no exclusion codes). */
export function passingPairs(input: MatchInput): FilterOutcome[] {
  return filterOnly(input).filter((o) => o.excluded.length === 0);
}
