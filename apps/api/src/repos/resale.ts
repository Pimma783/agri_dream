import { z } from 'zod';
import { type Db, dec, maybe, ts, uuid } from './db.js';
import { type Insertable, table } from './table.js';
export const ResaleAllocationRow = z.object({
  id: uuid,
  source_agreement_id: uuid,
  draft_id: uuid.nullable(),
  listing_id: uuid.nullable(),
  qty_kg: dec,
  status: z.enum(['ACTIVE', 'RELEASED']),
  is_demo: z.boolean(),
  created_at: ts,
  updated_at: ts,
});
export type ResaleAllocation = z.infer<typeof ResaleAllocationRow>;
const t = table('resale_allocations', ResaleAllocationRow, { touch: true });
export const resaleAllocations = {
  insert: (db: Db, v: Insertable<ResaleAllocation, 'source_agreement_id' | 'qty_kg' | 'status'>) => t.insert(db, v),
  get: t.get,
  getForUpdate: t.getForUpdate,
  getByDraft: async (db: Db, draftId: string) => (await t.where(db, { draft_id: draftId }))[0] ?? null,
  getByListing: async (db: Db, listingId: string) => (await t.where(db, { listing_id: listingId }))[0] ?? null,
  update: (db: Db, id: string, patch: Partial<Pick<ResaleAllocation, 'qty_kg' | 'status' | 'listing_id'>>) =>
    t.update(db, id, patch),
  listBySource: (db: Db, agreementId: string) => t.where(db, { source_agreement_id: agreementId }, { orderBy: 'created_at' }),
  /** Sum of ACTIVE allocations for an agreement, for reconciliation against resale_reserved_kg. */
  async activeTotal(db: Db, agreementId: string): Promise<string> {
    const row = await maybe(
      db,
      z.object({ total: dec }),
      `SELECT COALESCE(SUM(qty_kg), 0)::text AS total FROM resale_allocations WHERE source_agreement_id = $1 AND status = 'ACTIVE'`,
      [agreementId],
    );
    return row?.total ?? '0';
  },
};
