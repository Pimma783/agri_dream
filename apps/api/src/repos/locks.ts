import { type Db, exec } from './db.js';

/** Tables whose rows services may lock. Names are interpolated, so they come from this closed list only. */
const LOCKABLE = [
  'agreements', 'baling_requests', 'baling_services', 'drafts', 'jobs', 'material_listings',
  'notification_outbox', 'offers', 'purchase_demands', 'resale_allocations',
] as const;
export type LockableTable = (typeof LOCKABLE)[number];
export interface LockTarget {
  table: LockableTable;
  id: string;
}

/** The fixed global lock order: by table name, then id. */
export function sortLockTargets(targets: readonly LockTarget[]): LockTarget[] {
  return [...targets].sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Lock rows with SELECT ... FOR UPDATE, one statement each, in (table, id) order, so two transactions
 * touching the same rows can never wait on each other in opposite order. Returns how many were found.
 */
export async function lockRows(db: Db, targets: readonly LockTarget[]): Promise<number> {
  let found = 0;
  for (const t of sortLockTargets(targets)) {
    if (!LOCKABLE.includes(t.table)) throw new Error(`table not lockable: ${t.table}`);
    found += await exec(db, `SELECT 1 FROM ${t.table} WHERE id = $1 FOR UPDATE`, [t.id]);
  }
  return found;
}
