// Layer: services. Resale drafts (Requirement 14.2, 14.4, 14.5, 14.9). A BALER of the buyer organization of a
// PURCHASE_CONFIRMED agreement creates a RESALE_LISTING draft from it. The draft is never published here,
// and drafts.create refuses this kind, so this is the only way to start one.
// Copied from the source: material type and a quantity. Never copied: the source listing's location,
// farmer contact data, or any image assessment (those describe the pre-baling material). The draft starts
// as pending material (Requirement 14.6/14.7): nothing marks it received or baled.
import { z } from 'zod';
import type { Actor } from '../../domain/permissions.js';
import { D, parseDecimal } from '../../domain/units.js';
import { agreements, drafts, listings } from '../../repos/index.js';
import { audit } from '../audit.js';
import { authorized, inTransaction, registerService, type ServiceContext } from '../context.js';
import type { DraftView } from '../drafts/index.js';
import { completeness } from '../drafts/schemas.js';
import { appError } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import { availableKg, reserveForDraft } from './allocation.js';

export { releaseForDraft, releaseForListing, resizeForDraft } from './allocation.js';

registerService('resale', 'RESALE_DRAFT_CREATE');

export interface ResaleService {
  /** Create the draft and reserve its quantity on the agreement. `qtyKg` defaults to what is still unreserved. */
  createDraft(actor: Actor, input: { agreementId: string; qtyKg?: string }): Promise<Result<DraftView>>;
}

const QtySchema = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/);

export function createResaleService(ctx: ServiceContext): ResaleService {
  return {
    async createDraft(actor, input) {
      const idOk = z.uuid().safeParse(input?.agreementId).success;
      const pre = idOk ? await agreements.get(ctx.pool, input.agreementId) : null;
      // Role must be BALER (403). An agreement of another organization looks missing (404).
      return authorized(ctx, actor, 'RESALE_DRAFT_CREATE', pre ? { orgId: pre.buyer_org_id } : undefined, async () => {
        if (input.qtyKg !== undefined && (!QtySchema.safeParse(input.qtyKg).success || !parseDecimal(input.qtyKg)?.gt(0))) {
          return err(appError('VALIDATION', { fields: [{ path: 'qtyKg', message: 'INVALID_VALUE' }] }));
        }
        return inTransaction(ctx, async (tx): Promise<Result<DraftView>> => {
          const a = await agreements.getForUpdate(tx, input.agreementId);
          if (!a || a.buyer_org_id !== actor.orgId) return err(appError('NOT_FOUND'));
          if (a.kind !== 'PURCHASE' || a.status !== 'PURCHASE_CONFIRMED') {
            return err(appError('INVALID_STATE', { details: { state: a.status } }));
          }
          const avail = availableKg(a);
          if (!avail.gt(0)) return err(appError('ALLOCATION_EXCEEDED', { details: { available_kg: '0.000' } }));
          const qty = input.qtyKg !== undefined ? (parseDecimal(input.qtyKg) as InstanceType<typeof D>) : avail;
          const source = a.listing_id ? await listings.get(tx, a.listing_id) : null;
          if (!source) return err(appError('INVALID_STATE', { details: { state: 'NO_SOURCE_MATERIAL' } }));
          const data = { material_type: source.material_type, qty_kg: qty.toFixed(3), pending_material: true };
          const draft = await drafts.insert(tx, {
            org_id: actor.orgId, created_by: actor.userId, kind: 'RESALE_LISTING', data, status: 'DRAFT',
            source_agreement_id: a.id, is_demo: a.is_demo,
          });
          const r = await reserveForDraft(tx, { agreementId: a.id, draftId: draft.id, qtyKg: qty.toFixed(3), isDemo: a.is_demo });
          if (!r.ok) return err(r.error);
          await audit(tx, actor, {
            action: 'draft.created', entityType: 'draft', entityId: draft.id, entityVersion: draft.version,
            detail: { kind: 'RESALE_LISTING', source_agreement_id: a.id, qty_kg: qty.toFixed(3) },
          });
          const c = completeness(draft.kind, draft.data);
          return ok({ draft, complete: c.complete, missing_fields: c.missing });
        });
      });
    },
  };
}
