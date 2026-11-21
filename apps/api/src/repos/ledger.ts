import { z } from 'zod';
import { type Db, dec, many, maybe, ts, uuid } from './db.js';
// bigserial comes back from pg as a string.
export const LedgerRow = z.object({
  id: z.string().regex(/^\d+$/),
  subject_type: z.enum(['LISTING', 'DEMAND']),
  subject_id: uuid,
  agreement_id: uuid,
  entry_kind: z.enum(['COMMIT', 'RELEASE']),
  qty_kg: dec,
  created_at: ts,
});
export type LedgerEntry = z.infer<typeof LedgerRow>;
export interface LedgerInput {
  subject_type: LedgerEntry['subject_type'];
  subject_id: string;
  agreement_id: string;
  entry_kind: LedgerEntry['entry_kind'];
  qty_kg: string;
}
/** Append-only: there is no update or delete. */
export const ledger = {
  /** Returns null when the same (agreement, subject, kind) entry already exists. */
  append: (db: Db, e: LedgerInput) =>
    maybe(
      db,
      LedgerRow,
      `INSERT INTO quantity_ledger (subject_type, subject_id, agreement_id, entry_kind, qty_kg)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
      [e.subject_type, e.subject_id, e.agreement_id, e.entry_kind, e.qty_kg],
    ),
  listBySubject: (db: Db, subjectType: LedgerEntry['subject_type'], subjectId: string) =>
    many(db, LedgerRow, 'SELECT * FROM quantity_ledger WHERE subject_type = $1 AND subject_id = $2 ORDER BY id::bigint', [subjectType, subjectId]),
  listByAgreement: (db: Db, agreementId: string) =>
    many(db, LedgerRow, 'SELECT * FROM quantity_ledger WHERE agreement_id = $1 ORDER BY id::bigint', [agreementId]),
  /** Number of COMMIT entries for a subject written at or after `since` (the accepts that bumped its version). */
  async countCommitsSince(db: Db, subjectType: LedgerEntry['subject_type'], subjectId: string, since: Date): Promise<number> {
    const row = await maybe(
      db,
      z.object({ n: z.coerce.number().int() }),
      `SELECT count(*) AS n FROM quantity_ledger WHERE subject_type = $1 AND subject_id = $2 AND entry_kind = 'COMMIT' AND created_at >= $3`,
      [subjectType, subjectId, since],
    );
    return row?.n ?? 0;
  },
  /** COMMIT minus RELEASE for a subject, as a decimal string (reconciliation only; no rule here). */
  async netCommitted(db: Db, subjectType: LedgerEntry['subject_type'], subjectId: string): Promise<string> {
    const row = await maybe(
      db,
      z.object({ net: dec }),
      `SELECT COALESCE(SUM(CASE entry_kind WHEN 'COMMIT' THEN qty_kg ELSE -qty_kg END), 0)::text AS net
       FROM quantity_ledger WHERE subject_type = $1 AND subject_id = $2`,
      [subjectType, subjectId],
    );
    return row?.net ?? '0';
  },
};
