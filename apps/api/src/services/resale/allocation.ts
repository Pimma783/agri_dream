// Resale quantity reservation (Requirement 14.5, design A10). Every function runs inside the caller's
// transaction and takes the source agreement's row lock first, so concurrent drafts for one agreement
// serialize. The CHECK `resale_cap` (0 <= resale_reserved_kg <= qty_kg) is the backstop behind this code.
// Lock order is always: draft (if any) -> agreement -> allocation.
import { D, type Dec, parseDecimal } from '../../domain/units.js';
import { agreements, type Agreement, resaleAllocations, type ResaleAllocation, type Tx } from '../../repos/index.js';
import { appError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

const kg = (d: Dec): string => d.toFixed(3);
const dec = (s: string): Dec => parseDecimal(s) ?? new D(0);

/** Quantity of the agreement not yet reserved for resale. */
export const availableKg = (a: Pick<Agreement, 'qty_kg' | 'resale_reserved_kg'>): Dec =>
  dec(a.qty_kg).minus(dec(a.resale_reserved_kg));

/** Lock the agreement and add an ACTIVE allocation for a new draft. ALLOCATION_EXCEEDED when it does not fit. */
export async function reserveForDraft(
  tx: Tx,
  input: { agreementId: string; draftId: string; qtyKg: string; isDemo: boolean },
): Promise<Result<{ allocation: ResaleAllocation; agreement: Agreement }>> {
  const a = await agreements.getForUpdate(tx, input.agreementId);
  if (!a) return err(appError('NOT_FOUND'));
  const q = dec(input.qtyKg);
  if (!q.gt(0)) return err(appError('VALIDATION', { fields: [{ path: 'qty_kg', message: 'INVALID_VALUE' }] }));
  if (q.gt(availableKg(a))) {
    return err(appError('ALLOCATION_EXCEEDED', { details: { available_kg: kg(availableKg(a)) } }));
  }
  const allocation = await resaleAllocations.insert(tx, {
    source_agreement_id: a.id, draft_id: input.draftId, qty_kg: kg(q), status: 'ACTIVE', is_demo: input.isDemo,
  });
  const updated = await agreements.update(tx, a.id, { resale_reserved_kg: kg(dec(a.resale_reserved_kg).plus(q)) });
  if (!updated) return err(appError('NOT_FOUND'));
  return ok({ allocation, agreement: updated });
}

/** Change the reserved quantity of a draft's allocation, re-checking the cap (Requirement 14.5). */
export async function resizeForDraft(tx: Tx, draftId: string, newQtyKg: string): Promise<Result<true>> {
  const probe = await resaleAllocations.getByDraft(tx, draftId);
  if (!probe) return err(appError('NOT_FOUND'));
  const a = await agreements.getForUpdate(tx, probe.source_agreement_id);
  const alloc = await resaleAllocations.getForUpdate(tx, probe.id);
  if (!a || !alloc) return err(appError('NOT_FOUND'));
  if (alloc.status !== 'ACTIVE') return err(appError('INVALID_STATE', { details: { state: alloc.status } }));
  const next = dec(newQtyKg);
  if (!next.gt(0)) return err(appError('VALIDATION', { fields: [{ path: 'qty_kg', message: 'INVALID_VALUE' }] }));
  const delta = next.minus(dec(alloc.qty_kg));
  if (delta.isZero()) return ok(true);
  if (delta.gt(availableKg(a))) {
    return err(appError('ALLOCATION_EXCEEDED', { details: { available_kg: kg(availableKg(a).plus(dec(alloc.qty_kg))) } }));
  }
  await resaleAllocations.update(tx, alloc.id, { qty_kg: kg(next) });
  await agreements.update(tx, a.id, { resale_reserved_kg: kg(dec(a.resale_reserved_kg).plus(delta)) });
  return ok(true);
}

/**
 * Reduce an allocation to the sold quantity and release the rest. With nothing sold the allocation becomes
 * RELEASED. A missing or already released allocation is a no-op, so the call is safe to repeat.
 */
async function release(tx: Tx, probe: ResaleAllocation | null, soldKg: string): Promise<void> {
  if (!probe || probe.status !== 'ACTIVE') return;
  const a = await agreements.getForUpdate(tx, probe.source_agreement_id);
  const alloc = await resaleAllocations.getForUpdate(tx, probe.id);
  if (!a || !alloc || alloc.status !== 'ACTIVE') return;
  const current = dec(alloc.qty_kg);
  const sold = D.min(D.max(dec(soldKg), 0), current);
  const freed = current.minus(sold);
  if (freed.isZero()) return;
  await resaleAllocations.update(tx, alloc.id, sold.isZero() ? { status: 'RELEASED' } : { qty_kg: kg(sold) });
  await agreements.update(tx, a.id, { resale_reserved_kg: kg(dec(a.resale_reserved_kg).minus(freed)) });
}

/**
 * Before a RESALE_LISTING draft is published: the draft must still hold an ACTIVE allocation, the source
 * agreement must still be PURCHASE_CONFIRMED, and the listing quantity must not exceed the reserved quantity.
 * Locks agreement then allocation (the draft is already locked by the caller).
 */
export async function checkResalePublishable(tx: Tx, draftId: string, listingQtyKg: string): Promise<Result<ResaleAllocation>> {
  const probe = await resaleAllocations.getByDraft(tx, draftId);
  if (!probe) return err(appError('INVALID_STATE', { details: { state: 'NO_ALLOCATION' } }));
  const a = await agreements.getForUpdate(tx, probe.source_agreement_id);
  const alloc = await resaleAllocations.getForUpdate(tx, probe.id);
  if (!a || !alloc) return err(appError('NOT_FOUND'));
  if (alloc.status !== 'ACTIVE') return err(appError('INVALID_STATE', { details: { state: alloc.status } }));
  if (a.kind !== 'PURCHASE' || a.status !== 'PURCHASE_CONFIRMED') return err(appError('INVALID_STATE', { details: { state: a.status } }));
  if (dec(listingQtyKg).gt(dec(alloc.qty_kg))) {
    return err(appError('ALLOCATION_EXCEEDED', { details: { available_kg: kg(dec(alloc.qty_kg)) } }));
  }
  return ok(alloc);
}

/** After publishing: point the allocation at the new listing so close or cancel can find it (task 16.1 note). */
export async function linkAllocationToListing(tx: Tx, allocationId: string, listingId: string): Promise<void> {
  await resaleAllocations.update(tx, allocationId, { listing_id: listingId });
}

/** Draft discarded: release everything. */
export async function releaseForDraft(tx: Tx, draftId: string): Promise<void> {
  await release(tx, await resaleAllocations.getByDraft(tx, draftId), '0');
}

/** Listing closed or cancelled: keep the sold quantity reserved, release the unsold remainder. */
export async function releaseForListing(tx: Tx, listingId: string, soldKg: string): Promise<void> {
  await release(tx, await resaleAllocations.getByListing(tx, listingId), soldKg);
}
