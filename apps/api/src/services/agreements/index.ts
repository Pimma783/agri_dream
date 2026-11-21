// Layer: services. Read-only agreements for the two parties (Requirements 12.11, 16.5).
// Authorization: OFFER_READ with seller as owner and buyer as receiver, so any other organization gets NOT_FOUND,
// the same as a missing id. The view never carries payment or delivery state: an agreement only records confirmation.
import { z } from 'zod';
import { type Agreement, agreements } from '../../repos/index.js';
import type { Actor } from '../../domain/permissions.js';
import { authorized, registerService, type ServiceContext } from '../context.js';
import { appError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

registerService('agreements', 'OFFER_READ');

export interface AgreementView {
  id: string;
  kind: Agreement['kind'];
  offer_id: string;
  seller_org_id: string;
  buyer_org_id: string;
  listing_id: string | null;
  demand_id: string | null;
  baling_service_id: string | null;
  baling_request_id: string | null;
  qty_kg: string;
  unit_price_thb: string | null;
  price_unit: Agreement['price_unit'];
  total_amount_thb: string | null;
  status: Agreement['status'];
  resale_reserved_kg: string;
  source_agreement_id: string | null;
  version: number;
  is_demo: boolean;
  confirmed_at: string;
}

/** Allowlist mapper: decimals stay strings, timestamps are ISO. */
export function toAgreementView(a: Agreement): AgreementView {
  return {
    id: a.id, kind: a.kind, offer_id: a.offer_id, seller_org_id: a.seller_org_id, buyer_org_id: a.buyer_org_id,
    listing_id: a.listing_id, demand_id: a.demand_id, baling_service_id: a.baling_service_id, baling_request_id: a.baling_request_id,
    qty_kg: a.qty_kg, unit_price_thb: a.unit_price_thb, price_unit: a.price_unit, total_amount_thb: a.total_amount_thb,
    status: a.status, resale_reserved_kg: a.resale_reserved_kg, source_agreement_id: a.source_agreement_id,
    version: a.version, is_demo: a.is_demo, confirmed_at: a.confirmed_at.toISOString(),
  };
}

/** Strict: unknown keys are a 422. `kind` keeps baling-service agreements apart from purchases (Requirement 13.3). */
export const ListAgreementsSchema = z.strictObject({ kind: z.enum(['PURCHASE', 'BALING_SERVICE']).optional() });
export type ListAgreementsFilter = z.infer<typeof ListAgreementsSchema>;

/**
 * View for a specific viewer. The downstream buyer of a resale agreement sees no link to the upstream
 * agreement (and so nothing leading to the farmer, Requirement 14.9); the baler who resold keeps the link.
 */
export function toAgreementViewFor(a: Agreement, viewerOrgId: string): AgreementView {
  const v = toAgreementView(a);
  return a.source_agreement_id !== null && a.buyer_org_id === viewerOrgId ? { ...v, source_agreement_id: null } : v;
}

export interface AgreementReadService {
  get(actor: Actor, id: string): Promise<Result<Agreement>>;
  list(actor: Actor, filter?: unknown): Promise<Result<Agreement[]>>;
}

export function createAgreementReadService(ctx: ServiceContext): AgreementReadService {
  const idSchema = z.uuid();
  return {
    async get(actor, id) {
      const row = idSchema.safeParse(id).success ? await agreements.get(ctx.pool, id) : null;
      const resource = row ? { orgId: row.seller_org_id, receiverOrgId: row.buyer_org_id } : undefined;
      return authorized(ctx, actor, 'OFFER_READ', resource, async () => (row ? ok(row) : err(appError('NOT_FOUND'))));
    },
    list: (actor, filter = {}) =>
      authorized(ctx, actor, 'OFFER_READ', { orgId: actor.orgId }, async () => {
        const parsed = ListAgreementsSchema.safeParse(filter);
        if (!parsed.success) {
          return err(appError('VALIDATION', { fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }));
        }
        const { kind } = parsed.data;
        const all = await agreements.listByOrg(ctx.pool, actor.orgId);
        return ok(kind === undefined ? all : all.filter((a) => a.kind === kind));
      }),
  };
}
