// Pure matching types (design.md "Matching engine"). No I/O, no clock: the caller passes `now`.
// Quantities and prices are decimal.js values (kg, THB/kg). Integration with domain/units branded
// types is deferred until domain/units lands; `Decimal` is the shared representation underneath.
import type { Decimal } from 'decimal.js';

export type Route = 1 | 2 | 3 | 4;

export const MATERIALS = ['RICE_STRAW', 'CORN_STOVER', 'SUGARCANE_TRASH', 'OTHER'] as const;
export type Material = (typeof MATERIALS)[number];

export const FORMS = ['LOOSE', 'BALED', 'CHOPPED'] as const;
export type Form = (typeof FORMS)[number];

/** Filter stage exclusion codes, in the fixed evaluation order. */
export const EXCLUSION_CODES = [
  'NOT_PUBLISHED',
  'NO_REMAINING',
  'SAME_ORG',
  'MATERIAL_MISMATCH',
  'FORM_MISMATCH',
  'BELOW_MIN_LOT',
  'WINDOW_NO_OVERLAP',
  'AREA_MISMATCH',
  'OVER_RADIUS',
  'OVER_MAX_TRANSPORT',
] as const;
export type ExclusionCode = (typeof EXCLUSION_CODES)[number];

export const TRADE_COMPONENT_KEYS = ['distance', 'quantity', 'price', 'time', 'conditions'] as const;
export type TradeComponentKey = (typeof TRADE_COMPONENT_KEYS)[number];

export const SERVICE_COMPONENT_KEYS = ['serviceArea', 'materialForm', 'time', 'quantity', 'price'] as const;
export type ServiceComponentKey = (typeof SERVICE_COMPONENT_KEYS)[number];

export type ComponentKey = TradeComponentKey | ServiceComponentKey;

/** Weights as decimal strings, so config files contain exact values (no float drift). */
export type TradeWeights = Readonly<Record<TradeComponentKey, string>>;
export type ServiceWeights = Readonly<Record<ServiceComponentKey, string>>;

export interface RuleConfig {
  readonly version: string;
  /** Hard cap on straight-line transport distance for routes 1, 2 and 4 (km). */
  readonly maxTransportKm: number;
  readonly trade: TradeWeights;
  readonly service: ServiceWeights;
}

export type Flag =
  | { code: 'NEEDS_CONFIRMATION'; field: string }
  | { code: 'INCOMPLETE' }
  | { code: 'PRICE_MISMATCH' }
  | { code: 'DISTANCE_UNVERIFIED' };

export type ReasonCode =
  | 'DISTANCE_KM'
  | 'QTY_COVERAGE'
  | 'PRICE_WITHIN_BUDGET'
  | 'PRICE_ABOVE_BUDGET'
  | 'WINDOW_OVERLAP_DAYS'
  | `MISSING_${string}`;

export interface Reason {
  readonly code: ReasonCode;
  readonly params: Readonly<Record<string, string | number | null>>;
}

export interface ComponentScore {
  /** Decimal string in [0,1] at 4 dp; null means unknown (never counted as 0). */
  readonly value: string | null;
  readonly weight: string;
}

export interface MatchResult {
  route: Route;
  supplyId: string;
  demandId: string;
  ruleVersion: string;
  /** Present only from filterOnly(); engine output omits excluded pairs. */
  excluded?: ExclusionCode[];
  /** Decimal string 0-100, 2 dp. */
  score: string;
  components: Partial<Record<ComponentKey, ComponentScore>>;
  /** Sum of weights of known components, 0-1. */
  weightCoverage: string;
  flags: Flag[];
  distanceKm: string | null;
  distanceKind: 'straight_line' | null;
  reasons: Reason[];
  /** 0 = all mandatory checks confirmed and coverage 1; 1 = something needs confirmation. */
  tier: 0 | 1;
}

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

/** Price per unit; null amount with NEGOTIABLE means unknown for scoring. */
export type PriceUnit = 'THB_PER_KG' | 'THB_PER_TON' | 'THB_PER_BALE';
export interface Price {
  readonly negotiable: boolean;
  readonly amount: Decimal | null;
  readonly unit: PriceUnit | null;
}

export interface SupplySubject {
  readonly id: string;
  readonly orgId: string;
  readonly published: boolean;
  readonly material: Material;
  readonly form: Form | null;
  readonly remainingKg: Decimal;
  readonly minLotKg: Decimal | null;
  readonly window: TimeWindow | null;
  readonly location: GeoPoint | null;
  readonly province: string | null;
  readonly price: Price | null;
  readonly kind: 'SALE' | 'RESALE' | 'BALING_REQUEST';
  // Optional scoring inputs. Absent or null means unknown, never a pass (task 3.3).
  readonly moisturePct?: Decimal | null;
  readonly transport?: TransportResponsibility | null;
  /** Route 3: how the requester wants the baling done. */
  readonly balingMode?: BalingMode | null;
  /** Route 3: bale format the requester wants, as a free code such as 'ROUND' or 'SQUARE'. */
  readonly baleFormat?: string | null;
}

export type TransportResponsibility = 'SELLER_DELIVERS' | 'BUYER_PICKS_UP' | 'EITHER';
export type BalingMode = 'ON_SITE' | 'OFF_SITE';

export interface DemandSubject {
  readonly id: string;
  readonly orgId: string;
  readonly published: boolean;
  readonly material: Material;
  readonly forms: readonly Form[];
  readonly remainingKg: Decimal;
  readonly minLotKg: Decimal | null;
  readonly window: TimeWindow | null;
  readonly location: GeoPoint | null;
  readonly radiusKm: number | null;
  readonly provinces: readonly string[];
  readonly price: Price | null;
  // Optional scoring inputs. Absent or null means unknown, never a pass (task 3.3).
  readonly maxMoisturePct?: Decimal | null;
  readonly transport?: TransportResponsibility | null;
  /** Route 3: baling modes the service offers. Empty or absent = unknown. */
  readonly balingModes?: readonly BalingMode[];
  /** Route 3: bale formats the service offers. Empty or absent = unknown. */
  readonly baleFormats?: readonly string[];
  /** Route 3: kg the service can bale in the window. Null or absent = unknown. */
  readonly capacityKg?: Decimal | null;
}

export interface MatchInput {
  readonly route: Route;
  readonly supplies: readonly SupplySubject[];
  readonly demands: readonly DemandSubject[];
  readonly config: RuleConfig;
  /** Passed by the caller; the engine never reads the clock. */
  readonly now: Date;
}
