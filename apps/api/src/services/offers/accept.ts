// Layer: services. The accept-offer transaction (Requirements 12 and 13).
//
// One transaction at READ COMMITTED with explicit row locks, in this order:
//   1. the offer row (FOR UPDATE)
//   2. the rows it references, sorted by (table, id) through lockRows: listing + demand, or baling service + request
// Everything that decides the outcome is read after those locks, so two accepts that touch the same listing
// serialize on its row and the second one sees the reduced remaining quantity. CHECK constraints, the UNIQUE
// agreements.offer_id and the unique ledger rows stay as a backstop.
// A failed check returns an Err result: the transaction rolls back, so the offer stays PENDING.
// The agreement only records the confirmation. It never says delivered, paid or baled.
import { kg, kgToDb } from '../../domain/units.js';
import type { Actor } from '../../domain/permissions.js';
import {
  type Agreement, agreements, balingRequests, balingServices, demands, dbNow, ledger, listings, lockRows, offers, type Offer, type Tx,
} from '../../repos/index.js';
import { audit } from '../audit.js';
import { inTransaction, nowOf, type ServiceContext } from '../context.js';
import { appError } from '../errors.js';
import { type Idempotent, withIdempotency } from '../idempotency.js';
import { enqueueRecompute } from '../recompute.js';
import { err, ok, type Result } from '../result.js';
import { notifyOrg } from './notify.js';
import { idempotencyKeySchema, validation } from './schemas.js';
import type { AcceptOfferInput, OfferAcceptor } from './index.js';

export interface AcceptResult {
  agreement: Agreement;
  offer: Offer;
  /** True when the offer was already accepted (or an Idempotency-Key replay): nothing was written this time. */
  replayed: boolean;
}

/** JSON-safe outcome stored for Idempotency-Key replay. */
interface Stored { agreementId: string }

const invalidState = (entity: string, state: string) => err(appError('INVALID_STATE', { details: { entity, state } }));

export function createOfferAcceptor(ctx: ServiceContext): OfferAcceptor {
  /** The clock: injected in tests, otherwise the database clock (not the transaction start, which may predate lock waits). */
  async function now(tx: Tx): Promise<Date> {
    return ctx.now ? nowOf(ctx) : dbNow(tx);
  }

  async function existing(tx: Tx, offer: Offer): Promise<Result<Stored>> {
    const a = await agreements.getByOffer(tx, offer.id);
    // ACCEPTED without an agreement cannot happen (same transaction); do not invent one.
    return a ? ok({ agreementId: a.id }) : err(appError('INTERNAL', { details: { reason: 'ACCEPTED_WITHOUT_AGREEMENT' } }));
  }

  async function run(tx: Tx, actor: Actor, input: AcceptOfferInput): Promise<Result<Stored & { created: boolean }>> {
    const offer = await offers.getForUpdate(tx, input.offerId);
    if (!offer || offer.to_org_id !== actor.orgId) return err(appError('NOT_FOUND'));

    if (offer.status === 'ACCEPTED') {
      const e = await existing(tx, offer);
      return e.ok ? ok({ ...e.value, created: false }) : e;
    }
    if (offer.status !== 'PENDING') return invalidState('offer', offer.status);
    if (offer.expires_at.getTime() <= (await now(tx)).getTime()) return err(appError('OFFER_EXPIRED'));

    const created = offer.kind === 'PURCHASE' ? await acceptPurchase(tx, actor, offer, input) : await acceptBaling(tx, actor, offer);
    if (!created.ok) return created;
    const agreement = created.value;

    const done = await offers.update(tx, offer.id, { status: 'ACCEPTED' }, { expectedVersion: offer.version });
    if (!done) return err(appError('STALE_VERSION'));

    await audit(tx, actor, {
      action: 'offer.accepted', entityType: 'offer', entityId: offer.id, entityVersion: done.version,
      detail: { from: 'PENDING', to: 'ACCEPTED', agreement_id: agreement.id },
    });
    await audit(tx, actor, {
      action: 'agreement.created', entityType: 'agreement', entityId: agreement.id, entityVersion: agreement.version,
      detail: { kind: agreement.kind, status: agreement.status, offer_id: offer.id, qty_kg: agreement.qty_kg },
    });
    // Both parties are told, in the same transaction (Requirement 15.1). dedupe_key makes a repeat insert a no-op.
    await notifyOrg(tx, offer.from_org_id, 'accepted', done);
    await notifyOrg(tx, offer.to_org_id, 'accepted', done);
    return ok({ agreementId: agreement.id, created: true });
  }

  async function acceptPurchase(tx: Tx, actor: Actor, offer: Offer, input: AcceptOfferInput): Promise<Result<Agreement>> {
    if (!offer.listing_id || !offer.demand_id) return err(appError('INTERNAL', { details: { reason: 'OFFER_REFS_MISSING' } }));
    const found = await lockRows(tx, [
      { table: 'material_listings', id: offer.listing_id },
      { table: 'purchase_demands', id: offer.demand_id },
    ]);
    if (found !== 2) return err(appError('NOT_FOUND'));
    // Read after the locks: these are the values no other accept can change until we commit.
    const listing = await listings.get(tx, offer.listing_id);
    const demand = await demands.get(tx, offer.demand_id);
    if (!listing || !demand) return err(appError('NOT_FOUND'));

    if (listing.status !== 'PUBLISHED') return invalidState('listing', listing.status);
    if (demand.status !== 'PUBLISHED') return invalidState('demand', demand.status);
    // The two parties of the offer must still be the owners of the two rows, one on each side.
    const parties = new Set([offer.from_org_id, offer.to_org_id]);
    if (listing.org_id === demand.org_id || !parties.has(listing.org_id) || !parties.has(demand.org_id)) {
      return invalidState('offer', 'PARTIES_CHANGED');
    }

    // Versions: a change to the listing or demand terms since the offer was made is STALE_VERSION.
    // Every accept bumps the version once, so bumps caused by accepted quantity since then are not a change.
    const listingDrift = await driftSince(tx, 'LISTING', listing.id, offer, listing.version, offer.listing_version);
    const demandDrift = await driftSince(tx, 'DEMAND', demand.id, offer, demand.version, offer.demand_version);
    if (listingDrift > 0 || demandDrift > 0) return err(appError('STALE_VERSION'));

    const qty = kg(offer.qty_kg);
    if (demand.min_lot_kg !== null && qty.lt(kg(demand.min_lot_kg))) {
      return err(appError('VALIDATION', { fields: [{ path: 'qtyKg', message: 'ปริมาณน้อยกว่าขั้นต่ำต่อล็อตของผู้ซื้อ' }] }));
    }
    // Requirement 14.11: material not yet received or baled needs the buyer's acknowledgement.
    if (listing.pending_material && !offer.ack_pending_material && input.ackPendingMaterial !== true) {
      return err(appError('VALIDATION', { fields: [{ path: 'ackPendingMaterial', message: 'ต้องรับทราบว่าวัสดุอยู่ระหว่างรอรับ/รออัด' }] }));
    }
    // A9: not enough left means 409 and the offer stays PENDING (the Err rolls this transaction back).
    if (qty.gt(kg(listing.remaining_qty_kg)) || qty.gt(kg(demand.remaining_qty_kg))) return err(appError('INSUFFICIENT_QUANTITY'));

    const agreement = await agreements.insert(tx, {
      kind: 'PURCHASE',
      offer_id: offer.id,
      seller_org_id: listing.org_id,
      buyer_org_id: demand.org_id,
      listing_id: listing.id,
      demand_id: demand.id,
      qty_kg: kgToDb(qty),
      unit_price_thb: offer.unit_price_thb,
      price_unit: offer.price_unit,
      total_amount_thb: offer.total_amount_thb,
      status: 'PURCHASE_CONFIRMED',
      source_agreement_id: listing.source_agreement_id,
      is_demo: offer.is_demo,
    });
    const q = kgToDb(qty);
    await ledger.append(tx, { subject_type: 'LISTING', subject_id: listing.id, agreement_id: agreement.id, entry_kind: 'COMMIT', qty_kg: q });
    await ledger.append(tx, { subject_type: 'DEMAND', subject_id: demand.id, agreement_id: agreement.id, entry_kind: 'COMMIT', qty_kg: q });

    const listingLeft = kg(kg(listing.remaining_qty_kg).minus(qty));
    const demandLeft = kg(kg(demand.remaining_qty_kg).minus(qty));
    // One update per row so the version moves exactly once per accept (see driftSince).
    const listingNow = await listings.update(tx, listing.id, {
      committed_qty_kg: kgToDb(kg(kg(listing.committed_qty_kg).plus(qty))),
      remaining_qty_kg: kgToDb(listingLeft),
      ...(listingLeft.isZero() ? { status: 'CLOSED' as const } : {}),
    });
    const demandNow = await demands.update(tx, demand.id, {
      committed_qty_kg: kgToDb(kg(kg(demand.committed_qty_kg).plus(qty))),
      remaining_qty_kg: kgToDb(demandLeft),
      ...(demandLeft.isZero() ? { status: 'CLOSED' as const } : {}),
    });
    // The version moved, and stored matches of an older version are hidden. Recompute both rows so what is still
    // for sale or still wanted keeps its matches (same transaction: a rollback queues nothing).
    if (listingNow) await enqueueRecompute(tx, { entity_type: 'LISTING', entity_id: listing.id, version: listingNow.version });
    if (demandNow) await enqueueRecompute(tx, { entity_type: 'DEMAND', entity_id: demand.id, version: demandNow.version });
    return ok(agreement);
  }

  /** Baling: lock the offer's service and request for the state checks. No quantity is read or written (Requirement 13.2). */
  async function acceptBaling(tx: Tx, actor: Actor, offer: Offer): Promise<Result<Agreement>> {
    if (!offer.baling_service_id || !offer.baling_request_id) return err(appError('INTERNAL', { details: { reason: 'OFFER_REFS_MISSING' } }));
    const found = await lockRows(tx, [
      { table: 'baling_services', id: offer.baling_service_id },
      { table: 'baling_requests', id: offer.baling_request_id },
    ]);
    if (found !== 2) return err(appError('NOT_FOUND'));
    const service = await balingServices.get(tx, offer.baling_service_id);
    const request = await balingRequests.get(tx, offer.baling_request_id);
    if (!service || !request) return err(appError('NOT_FOUND'));
    if (service.status !== 'PUBLISHED') return invalidState('baling_service', service.status);
    if (request.status !== 'PUBLISHED') return invalidState('baling_request', request.status);
    const parties = new Set([offer.from_org_id, offer.to_org_id]);
    if (service.org_id === request.org_id || !parties.has(service.org_id) || !parties.has(request.org_id) || actor.orgId !== offer.to_org_id) {
      return invalidState('offer', 'PARTIES_CHANGED');
    }
    // The farmer keeps the material; the agreement records only the service the baler provides.
    return ok(await agreements.insert(tx, {
      kind: 'BALING_SERVICE',
      offer_id: offer.id,
      seller_org_id: service.org_id,
      buyer_org_id: request.org_id,
      baling_service_id: service.id,
      baling_request_id: request.id,
      qty_kg: offer.qty_kg,
      unit_price_thb: offer.unit_price_thb,
      price_unit: offer.price_unit,
      total_amount_thb: offer.total_amount_thb,
      status: 'SERVICE_CONFIRMED',
      is_demo: offer.is_demo,
    }));
  }

  /**
   * Version bumps on a listing or demand since the offer snapshot that were NOT an accepted quantity.
   * Each accept since the offer was created bumps the version once and leaves a COMMIT ledger row, so those are
   * subtracted. A positive result means the terms (or status) changed. A null snapshot means nothing to compare.
   */
  async function driftSince(
    tx: Tx, type: 'LISTING' | 'DEMAND', id: string, offer: Offer, current: number, snapshot: number | null,
  ): Promise<number> {
    if (snapshot === null) return 0;
    const accepted = await ledger.countCommitsSince(tx, type, id, offer.created_at);
    return current - snapshot - accepted;
  }

  return async (actor, input) => {
    let r: Result<Idempotent<Stored & { created: boolean }>>;
    if (input.idempotencyKey === undefined) {
      r = await inTransaction(ctx, async (tx) => {
        const x = await run(tx, actor, input);
        return x.ok ? ok({ value: x.value, replayed: !x.value.created }) : x;
      });
    } else {
      const k = idempotencyKeySchema.safeParse(input.idempotencyKey);
      if (!k.success) return err(validation(k.error.issues));
      r = await withIdempotency(
        ctx,
        { orgId: actor.orgId, scope: `offer.accept:${input.offerId}`, key: input.idempotencyKey, request: { offerId: input.offerId, ack: input.ackPendingMaterial ?? false } },
        async (tx) => {
          const x = await run(tx, actor, input);
          return x.ok ? ok({ agreementId: x.value.agreementId, created: x.value.created }) : x;
        },
      );
      if (r.ok && r.value.replayed === false && r.value.value.created === false) r = ok({ ...r.value, replayed: true });
    }
    if (!r.ok) return r;
    const agreement = await agreements.get(ctx.pool, r.value.value.agreementId);
    const offer = await offers.get(ctx.pool, input.offerId);
    if (!agreement || !offer) return err(appError('NOT_FOUND'));
    const result: AcceptResult = { agreement, offer, replayed: r.value.replayed };
    return ok(result);
  };
}
