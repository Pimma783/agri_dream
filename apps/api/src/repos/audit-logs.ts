import { z } from 'zod';
import { type Db, json, many, one, ts, uuid } from './db.js';
export const AuditLogRow = z.object({
  id: z.string().regex(/^\d+$/), // bigserial
  actor_user_id: uuid.nullable(),
  actor_org_id: uuid.nullable(),
  channel: z.enum(['web', 'line', 'assistant', 'system']).nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: uuid.nullable(),
  entity_version: z.number().int().nullable(),
  detail: json,
  created_at: ts,
});
export type AuditLog = z.infer<typeof AuditLogRow>;
export interface AuditInput {
  actor_user_id?: string | null;
  actor_org_id?: string | null;
  channel?: AuditLog['channel'];
  action: string;
  entity_type: string;
  entity_id?: string | null;
  entity_version?: number | null;
  detail?: Record<string, unknown>;
}
/** Append-only: the database rejects update and delete. */
export const auditLogs = {
  append: (db: Db, e: AuditInput) =>
    one(
      db,
      AuditLogRow,
      `INSERT INTO audit_logs (actor_user_id, actor_org_id, channel, action, entity_type, entity_id, entity_version, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        e.actor_user_id ?? null, e.actor_org_id ?? null, e.channel ?? null, e.action, e.entity_type,
        e.entity_id ?? null, e.entity_version ?? null, JSON.stringify(e.detail ?? {}),
      ],
    ),
  listByEntity: (db: Db, entityType: string, entityId: string) =>
    many(db, AuditLogRow, 'SELECT * FROM audit_logs WHERE entity_type = $1 AND entity_id = $2 ORDER BY id::bigint', [entityType, entityId]),
};
