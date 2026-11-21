// Shared Zod DTOs for apps/api and apps/web.
// Conventions (design.md, "REST API"): decimals are strings, times are ISO UTC strings.
import { z } from 'zod';

/** Stable error codes (design.md, "Error Handling"). */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'CSRF',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'STALE_VERSION',
  'INVALID_STATE',
  'OFFER_EXPIRED',
  'INSUFFICIENT_QUANTITY',
  'ALLOCATION_EXCEEDED',
  'IDEMPOTENCY_MISMATCH',
  'CONFLICT_RETRY',
  'STORAGE_UNAVAILABLE',
  'INTERNAL',
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'LINK_CODE_INVALID',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** API error body: `{ error: { code, message_th, details? } }`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message_th: z.string(),
    details: z.unknown().optional(),
    /** VALIDATION only: the invalid fields. */
    fields: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    request_id: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Decimal values travel as strings, e.g. "1250.50". */
export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'decimal string');
/** ISO 8601 UTC timestamp. */
export const isoUtcSchema = z.string().datetime();

export const ROLES = ['FARMER', 'BALER', 'FACTORY'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Raw `GET /me` body from the API (what Express sends). `meResponseSchema` is the flat shape the web app uses. */
export const apiMeSchema = z.object({
  user: z.object({ id: z.string() }).passthrough(),
  org: z.object({ id: z.string(), name: z.string() }).passthrough().nullable(),
  role: z.enum(['FARMER', 'BALER', 'BUYER_FACTORY']).nullable(),
  csrf_secret: z.string(),
});
export type ApiMe = z.infer<typeof apiMeSchema>;

/** `GET /api/me`: the web app reads `csrf_secret` and sends it as `X-CSRF-Token`. */
export const meResponseSchema = z.object({
  user_id: z.string(),
  org_id: z.string(),
  org_name: z.string(),
  role: roleSchema,
  csrf_secret: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `POST /line-link-codes`: the code is shown once. */
export const LINE_CHANNELS = ['farmer', 'baler', 'factory'] as const;
export const lineChannelSchema = z.enum(LINE_CHANNELS);
export type LineChannelName = z.infer<typeof lineChannelSchema>;
export const lineLinkCodeResponseSchema = z.object({
  channel: lineChannelSchema,
  code: z.string(),
  expires_at: isoUtcSchema,
  basic_id: z.string().nullable(),
});
export type LineLinkCodeResponse = z.infer<typeof lineLinkCodeResponseSchema>;
/** `GET /line-identities`: link status for the member's role channel. */
export const lineIdentitiesResponseSchema = z.object({
  items: z.array(z.object({
    channel: lineChannelSchema,
    status: z.enum(['LINKED', 'UNLINKED']),
    basic_id: z.string().nullable(),
  })),
});
export type LineIdentitiesResponse = z.infer<typeof lineIdentitiesResponseSchema>;

/** `GET /healthz`: adapter kinds only, no secrets. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  adapters: z.record(z.string(), z.enum(['real', 'mock'])),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Status enums mirrored from db/migrations CHECK constraints (UI badges only). */
export const OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as const;
export const offerStatusSchema = z.enum(OFFER_STATUSES);
export type OfferStatus = z.infer<typeof offerStatusSchema>;

/** Listings, demands, baling services and baling requests share this lifecycle. */
export const POSTING_STATUSES = ['PUBLISHED', 'PAUSED', 'CLOSED', 'CANCELLED'] as const;
export const postingStatusSchema = z.enum(POSTING_STATUSES);
export type PostingStatus = z.infer<typeof postingStatusSchema>;

export const AGREEMENT_STATUSES = ['PURCHASE_CONFIRMED', 'SERVICE_CONFIRMED', 'NEEDS_REVIEW', 'CANCELLED'] as const;
export const agreementStatusSchema = z.enum(AGREEMENT_STATUSES);
export type AgreementStatus = z.infer<typeof agreementStatusSchema>;

export const IMAGE_ASSESSMENT_STATUSES = ['OK', 'UNASSESSABLE', 'UNAVAILABLE', 'FAILED'] as const;
export const imageAssessmentStatusSchema = z.enum(IMAGE_ASSESSMENT_STATUSES);
export type ImageAssessmentStatus = z.infer<typeof imageAssessmentStatusSchema>;

/** Generic list envelope used by dashboard list endpoints. */
export const listResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable().optional() });

// ---- Drafts, purchase demands and baling services (task 11.3) ---------------------------------
// Mirrors apps/api/src/services/drafts/schemas.ts (PATCH_SCHEMAS) and http/draft-routes.ts.
export const MATERIAL_TYPES = ['RICE_STRAW', 'CANE_LEAF', 'CORN_COB', 'OTHER'] as const;
export const materialTypeSchema = z.enum(MATERIAL_TYPES);
export type MaterialType = z.infer<typeof materialTypeSchema>;
export const MATERIAL_FORMS = ['LOOSE', 'BALED'] as const;
export const materialFormSchema = z.enum(MATERIAL_FORMS);
export type MaterialForm = z.infer<typeof materialFormSchema>;
export const TRANSPORT_BY = ['SELLER', 'BUYER', 'EITHER', 'UNKNOWN'] as const;
export const transportBySchema = z.enum(TRANSPORT_BY);
export type TransportBy = z.infer<typeof transportBySchema>;
export const SERVICE_MODES = ['ON_SITE', 'AT_FACTORY', 'BOTH'] as const;
export const serviceModeSchema = z.enum(SERVICE_MODES);
export type ServiceMode = z.infer<typeof serviceModeSchema>;
export const PRICE_MODES = ['FIXED', 'NEGOTIABLE'] as const;
export const priceModeSchema = z.enum(PRICE_MODES);
export type PriceMode = z.infer<typeof priceModeSchema>;
/** Draft kinds that the dashboard forms create. */
export const FORM_DRAFT_KINDS = ['PURCHASE_DEMAND', 'BALING_SERVICE'] as const;
export const formDraftKindSchema = z.enum(FORM_DRAFT_KINDS);
export type FormDraftKind = z.infer<typeof formDraftKindSchema>;

/** Quantity in a patch: the dashboard only sends kg or ton. */
export const quantityPatchSchema = z.object({ value: z.string().max(30), unit: z.enum(['kg', 'ton']) }).strict();
export type QuantityPatch = z.infer<typeof quantityPatchSchema>;
const placeName = z.string().trim().min(1).max(100);
const priceUnitPatch = (units: readonly [string, ...string[]]) =>
  z.object({ value: z.string().max(20), unit: z.enum(units) }).strict();
const qualityPatch = z
  .record(z.string().max(50), z.union([z.string().max(200), z.number().finite(), z.boolean()]))
  .refine((o) => Object.keys(o).length <= 20, 'too many keys');

/** Body of `PATCH /drafts/:id` (and `patch` of `POST /drafts`) for a PURCHASE_DEMAND draft. */
export const purchaseDemandPatchSchema = z
  .object({
    accepted_materials: z.array(materialTypeSchema).min(1).max(4),
    accepted_forms: z.array(materialFormSchema).min(1).max(2),
    target_quantity: quantityPatchSchema,
    min_lot: quantityPatchSchema,
    price_mode: priceModeSchema,
    price: priceUnitPatch(['kg', 'ton']),
    province: placeName,
    district: placeName,
    radius_km: z.string().max(10),
    accepted_provinces: z.array(placeName).max(10),
    window_from: z.string().max(40),
    window_to: z.string().max(40),
    quality: qualityPatch,
    transport_by: transportBySchema,
    accepts_pending_material: z.boolean(),
  })
  .partial()
  .strict();
export type PurchaseDemandPatch = z.infer<typeof purchaseDemandPatchSchema>;

/** Body for a BALING_SERVICE draft. */
export const balingServicePatchSchema = z
  .object({
    material_types: z.array(materialTypeSchema).min(1).max(4),
    baling_format: placeName,
    service_mode: serviceModeSchema,
    service_provinces: z.array(placeName).max(10),
    province: placeName,
    district: placeName,
    min_quantity: quantityPatchSchema,
    capacity: quantityPatchSchema,
    price_mode: priceModeSchema,
    price: priceUnitPatch(['kg', 'ton', 'bale']),
    transport_by: transportBySchema,
    available_from: z.string().max(40),
    available_to: z.string().max(40),
  })
  .partial()
  .strict();
export type BalingServicePatch = z.infer<typeof balingServicePatchSchema>;

export const draftKindSchema = z.enum(['SALE_LISTING', 'RESALE_LISTING', 'PURCHASE_DEMAND', 'BALING_SERVICE', 'BALING_REQUEST']);
export const draftStatusSchema = z.enum(['DRAFT', 'AWAITING_REVIEW', 'PUBLISHED', 'CANCELLED']);

/** `POST /drafts`, `GET /drafts/:id`, `PATCH /drafts/:id`, `POST /drafts/:id/cancel`. */
export const draftViewSchema = z.object({
  draft: z
    .object({
      id: z.string(),
      kind: draftKindSchema,
      status: draftStatusSchema,
      version: z.number().int().min(1),
      data: z.record(z.string(), z.unknown()),
      published_entity_type: z.string().nullable().optional(),
      published_entity_id: z.string().nullable().optional(),
      /** RESALE_LISTING drafts only: the Agreement the material comes from. */
      source_agreement_id: z.string().nullable().optional(),
      created_at: z.string().optional(),
    })
    .passthrough(),
  complete: z.boolean(),
  /** Canonical field keys that are missing or invalid, e.g. `target_qty_kg`. */
  missing_fields: z.array(z.string()),
});
export type DraftView = z.infer<typeof draftViewSchema>;
/** `GET /drafts`: every draft of the actor's organization. */
export const draftViewListSchema = z.array(draftViewSchema);

/** `POST /drafts/:id/publish` (needs `Idempotency-Key`). */
export const publishResultSchema = z.object({
  draft_id: z.string(),
  entity_type: z.enum(['LISTING', 'DEMAND', 'BALING_SERVICE', 'BALING_REQUEST']),
  entity_id: z.string(),
  draft_version: z.number().int(),
  replayed: z.boolean(),
});
export type PublishResult = z.infer<typeof publishResultSchema>;

const nullableDec = decimalStringSchema.nullable();
/** `GET /purchase-demands` item and `GET /purchase-demands/:id`. */
export const purchaseDemandSchema = z
  .object({
    id: z.string(),
    status: postingStatusSchema,
    version: z.number().int().min(1),
    accepted_materials: z.array(materialTypeSchema),
    accepted_forms: z.array(materialFormSchema),
    target_qty_kg: decimalStringSchema,
    committed_qty_kg: decimalStringSchema,
    remaining_qty_kg: decimalStringSchema,
    min_lot_kg: nullableDec,
    price_mode: priceModeSchema,
    max_unit_price_thb: nullableDec,
    price_unit: z.enum(['KG', 'TON']).nullable(),
    province: z.string().nullable(),
    district: z.string().nullable(),
    radius_km: nullableDec,
    accepted_provinces: z.array(z.string()),
    window_from: isoUtcSchema.nullable(),
    window_to: isoUtcSchema.nullable(),
    quality: z.record(z.string(), z.unknown()),
    transport_by: transportBySchema,
    accepts_pending_material: z.boolean(),
    created_at: isoUtcSchema,
  })
  .passthrough();
export type PurchaseDemand = z.infer<typeof purchaseDemandSchema>;
export const purchaseDemandListSchema = z.array(purchaseDemandSchema);

/** `GET /listings` item and `GET /listings/:id` (own organization only; resale listings have kind RESALE). */
export const listingViewSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['SALE', 'RESALE']),
    status: postingStatusSchema,
    version: z.number().int().min(1),
    material_type: materialTypeSchema,
    material_form: materialFormSchema.nullable(),
    total_qty_kg: decimalStringSchema,
    committed_qty_kg: decimalStringSchema,
    remaining_qty_kg: decimalStringSchema,
    price_mode: priceModeSchema,
    unit_price_thb: nullableDec,
    price_unit: z.enum(['KG', 'TON', 'BALE']).nullable(),
    province: z.string().nullable(),
    district: z.string().nullable(),
    pending_material: z.boolean(),
    expected_ready_at: isoUtcSchema.nullable(),
    source_agreement_id: z.string().nullable(),
    created_at: isoUtcSchema,
  })
  .passthrough();
export type ListingView = z.infer<typeof listingViewSchema>;
export const listingViewListSchema = z.array(listingViewSchema);

/** `GET /baling-services` item and `GET /baling-services/:id`. */
export const balingServiceSchema = z
  .object({
    id: z.string(),
    status: postingStatusSchema,
    version: z.number().int().min(1),
    material_types: z.array(materialTypeSchema),
    baling_format: z.string().nullable(),
    service_mode: serviceModeSchema,
    service_provinces: z.array(z.string()),
    province: z.string().nullable(),
    district: z.string().nullable(),
    min_qty_kg: nullableDec,
    capacity_kg: nullableDec,
    price_mode: priceModeSchema,
    unit_price_thb: nullableDec,
    price_unit: z.enum(['KG', 'TON', 'BALE']).nullable(),
    transport_by: transportBySchema,
    available_from: isoUtcSchema.nullable(),
    available_to: isoUtcSchema.nullable(),
    created_at: isoUtcSchema,
  })
  .passthrough();
export type BalingService = z.infer<typeof balingServiceSchema>;
export const balingServiceListSchema = z.array(balingServiceSchema);

/** Status actions of `POST /<resource>/:id/{pause,open,close,cancel}` with `{ expectedVersion }`. */
export const POSTING_ACTIONS = ['pause', 'open', 'close', 'cancel'] as const;
export type PostingAction = (typeof POSTING_ACTIONS)[number];

// ---- Matches (`GET /matches`, mirrors apps/api/src/services/matches/visibility.ts) ----
export const MATCH_FLAG_CODES = ['NEEDS_CONFIRMATION', 'INCOMPLETE', 'PRICE_MISMATCH', 'DISTANCE_UNVERIFIED'] as const;
export const matchFlagCodeSchema = z.enum(MATCH_FLAG_CODES);
export type MatchFlagCode = z.infer<typeof matchFlagCodeSchema>;

export const MATCH_ENTITY_KINDS = ['LISTING', 'DEMAND', 'BALING_REQUEST', 'BALING_SERVICE'] as const;
export const matchEntityKindSchema = z.enum(MATCH_ENTITY_KINDS);
export type MatchEntityKind = z.infer<typeof matchEntityKindSchema>;

export const matchViewSchema = z
  .object({
    id: z.string(),
    route: z.number().int().min(1).max(4),
    own_side: z.enum(['supply', 'demand']),
    own_entity_id: z.string(),
    tier: z.union([z.literal(0), z.literal(1)]),
    score: decimalStringSchema,
    score_label_th: z.string(),
    weights_label_th: z.string(),
    weights_disclaimer_th: z.string(),
    weight_coverage: decimalStringSchema.nullable(),
    components: z.record(z.string(), z.object({ value: decimalStringSchema.nullable(), weight: decimalStringSchema })),
    missing_components: z.array(z.string()),
    flags: z.array(z.object({ code: matchFlagCodeSchema, field: z.string().optional(), label_th: z.string() })),
    reasons: z.array(
      z.object({
        code: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        text_th: z.string(),
      }),
    ),
    distance: z.object({ km: decimalStringSchema, kind: z.literal('straight_line'), label_th: z.string() }).nullable(),
    rule_version: z.string(),
    is_demo: z.boolean(),
    computed_at: isoUtcSchema,
    counterparty: z.object({
      entity_type: matchEntityKindSchema,
      entity_id: z.string(),
      display_name: z.string().nullable(),
      org_kind: z.string(),
      province: z.string().nullable(),
      published: z.record(z.string(), z.unknown()),
    }),
  })
  .passthrough();
export type MatchView = z.infer<typeof matchViewSchema>;
export const matchListSchema = z.array(matchViewSchema);

// ---- Offers and agreements (task 8.7) ---------------------------------------------------------
// Mirrors apps/api/src/services/offers (schemas.ts, view.ts), services/agreements and http/offer-routes.ts.
// Decimals are strings. Requests may carry an `Idempotency-Key` header (create, edit, accept, reject, withdraw).
export const OFFER_KINDS = ['PURCHASE', 'BALING_SERVICE'] as const;
export const offerKindSchema = z.enum(OFFER_KINDS);
export const priceUnitSchema = z.enum(['KG', 'TON', 'BALE']);

const offerTermsShape = {
  qtyKg: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/),
  unitPriceThb: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/).nullable().optional(),
  priceUnit: priceUnitSchema.nullable().optional(),
  transportBy: transportBySchema.optional(),
  transportCostThb: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).nullable().optional(),
  readyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiresAt: isoUtcSchema.optional(),
  ackPendingMaterial: z.boolean().optional(),
};

/** `POST /offers`. Give `matchId`, or the referenced rows for the kind. */
export const createOfferRequestSchema = z
  .object({
    kind: offerKindSchema,
    matchId: z.string().uuid().optional(),
    listingId: z.string().uuid().optional(),
    demandId: z.string().uuid().optional(),
    balingServiceId: z.string().uuid().optional(),
    balingRequestId: z.string().uuid().optional(),
    ...offerTermsShape,
  })
  .strict();
export type CreateOfferRequest = z.infer<typeof createOfferRequestSchema>;

/** `POST /offers/:id/edit`: withdraws the PENDING offer and creates a new one. */
export const editOfferRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    changes: z.object({ ...offerTermsShape, qtyKg: offerTermsShape.qtyKg.optional() }).strict(),
  })
  .strict();
export type EditOfferRequest = z.infer<typeof editOfferRequestSchema>;

/** `POST /offers/:id/reject` and `/withdraw`. */
export const offerRefRequestSchema = z.object({ expectedVersion: z.number().int().min(1).optional() }).strict();
/** `POST /offers/:id/accept`. `ackPendingMaterial` acknowledges resale material not yet received or baled. */
export const acceptOfferRequestSchema = z.object({ ackPendingMaterial: z.boolean().optional() }).strict();

/** `GET /offers` query. */
export const offerListQuerySchema = z
  .object({ status: offerStatusSchema.optional(), direction: z.enum(['sent', 'received']).optional() })
  .strict();

/** Offer item for `GET /offers`, `GET /offers/:id`. */
export const offerViewSchema = z.object({
  id: z.string(),
  kind: offerKindSchema,
  from_org_id: z.string(),
  to_org_id: z.string(),
  listing_id: z.string().nullable(),
  demand_id: z.string().nullable(),
  baling_service_id: z.string().nullable(),
  baling_request_id: z.string().nullable(),
  qty_kg: decimalStringSchema,
  unit_price_thb: decimalStringSchema.nullable(),
  price_unit: priceUnitSchema.nullable(),
  total_amount_thb: decimalStringSchema.nullable(),
  transport_by: transportBySchema,
  transport_cost_thb: decimalStringSchema.nullable(),
  ready_date: z.string().nullable(),
  expires_at: isoUtcSchema,
  ack_pending_material: z.boolean(),
  status: offerStatusSchema,
  supersedes_offer_id: z.string().nullable(),
  version: z.number().int().min(1),
  is_demo: z.boolean(),
  created_at: isoUtcSchema,
  direction: z.enum(['sent', 'received']),
});
export type OfferView = z.infer<typeof offerViewSchema>;
export const offerListSchema = z.array(offerViewSchema);

/** `POST /offers` (201, or 200 on replay), reject, withdraw, edit (`replaced` is the withdrawn offer). */
export const offerResultSchema = z.object({
  offer: offerViewSchema,
  replaced: offerViewSchema.optional(),
  replayed: z.boolean(),
});
export type OfferResultView = z.infer<typeof offerResultSchema>;

/** Agreement item for `GET /agreements`, `GET /agreements/:id`. It records confirmation only: no payment or delivery state. */
export const agreementViewSchema = z.object({
  id: z.string(),
  kind: offerKindSchema,
  offer_id: z.string(),
  seller_org_id: z.string(),
  buyer_org_id: z.string(),
  listing_id: z.string().nullable(),
  demand_id: z.string().nullable(),
  baling_service_id: z.string().nullable(),
  baling_request_id: z.string().nullable(),
  qty_kg: decimalStringSchema,
  unit_price_thb: decimalStringSchema.nullable(),
  price_unit: priceUnitSchema.nullable(),
  total_amount_thb: decimalStringSchema.nullable(),
  status: agreementStatusSchema,
  resale_reserved_kg: decimalStringSchema,
  source_agreement_id: z.string().nullable(),
  version: z.number().int().min(1),
  is_demo: z.boolean(),
  confirmed_at: isoUtcSchema,
});
export type AgreementView = z.infer<typeof agreementViewSchema>;
export const agreementListSchema = z.array(agreementViewSchema);

/** `POST /offers/:id/accept`. */
export const acceptOfferResultSchema = z.object({
  agreement: agreementViewSchema,
  offer: offerViewSchema,
  replayed: z.boolean(),
});
export type AcceptOfferResult = z.infer<typeof acceptOfferResultSchema>;
// ---- In-app notifications (`GET /notifications`, mirrors apps/api/src/services/notifications) ----
export const NOTIFICATION_KINDS = ['NEW_MATCH'] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export const notificationSchema = z.object({
  id: z.string(),
  kind: notificationKindSchema,
  route: z.number().int().min(1).max(4),
  title_th: z.string(),
  body_th: z.string(),
  /** Relative web path, for example `/matches/<id>`. */
  link_path: z.string().startsWith('/'),
  created_at: isoUtcSchema,
  read_at: isoUtcSchema.nullable(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread_count: z.number().int().min(0),
});
export type NotificationListDto = z.infer<typeof notificationListSchema>;
/** `POST /notifications/:id/read` and `POST /notifications/read-all`. */
export const notificationUnreadSchema = z.object({ unread_count: z.number().int().min(0) });
export type NotificationUnreadDto = z.infer<typeof notificationUnreadSchema>;
