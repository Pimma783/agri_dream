// Audit log helper. Append-only table; details must never hold secrets, message text or contact data.
import type { Actor } from '../domain/permissions.js';
import { auditLogs, type AuditLog, type Db } from '../repos/index.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityVersion?: number | null;
  detail?: Record<string, unknown>;
}

const channelOf = (a: Actor): NonNullable<AuditLog['channel']> =>
  a.channel === 'web' ? 'web' : a.channel === 'assistant' ? 'assistant' : 'line';

/** Write inside the caller's transaction so the audit row commits or rolls back with the change. */
export function audit(db: Db, actor: Actor, e: AuditEntry): Promise<AuditLog> {
  return auditLogs.append(db, {
    actor_user_id: actor.userId,
    actor_org_id: actor.orgId,
    channel: channelOf(actor),
    action: e.action,
    entity_type: e.entityType,
    entity_id: e.entityId ?? null,
    entity_version: e.entityVersion ?? null,
    detail: e.detail ?? {},
  });
}

/** For system actors (jobs, sweepers) that have no user. */
export function auditSystem(db: Db, e: AuditEntry): Promise<AuditLog> {
  return auditLogs.append(db, {
    channel: 'system',
    action: e.action,
    entity_type: e.entityType,
    entity_id: e.entityId ?? null,
    entity_version: e.entityVersion ?? null,
    detail: e.detail ?? {},
  });
}
