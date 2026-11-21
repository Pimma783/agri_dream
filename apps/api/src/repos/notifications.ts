import { z } from 'zod';
import { type Db, exec, many, maybe, ts, uuid } from './db.js';

export const NOTIFICATION_KINDS = ['NEW_MATCH'] as const;
export const NotificationRow = z.object({
  id: uuid,
  org_id: uuid,
  kind: z.enum(NOTIFICATION_KINDS),
  route: z.number().int().min(1).max(4),
  supply_id: uuid,
  demand_id: uuid,
  title_th: z.string(),
  body_th: z.string(),
  link_path: z.string(),
  created_at: ts,
  read_at: ts.nullable(),
});
export type Notification = z.infer<typeof NotificationRow>;

export interface NotificationInput {
  org_id: string;
  kind: (typeof NOTIFICATION_KINDS)[number];
  route: number;
  supply_id: string;
  demand_id: string;
  title_th: string;
  body_th: string;
  link_path: string;
}

export const notifications = {
  /** Insert once per (org, kind, supply, demand). Returns false when the pair already notified. */
  async insertIfAbsent(db: Db, n: NotificationInput): Promise<boolean> {
    return (
      (await exec(
        db,
        `INSERT INTO notifications (org_id, kind, route, supply_id, demand_id, title_th, body_th, link_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (org_id, kind, supply_id, demand_id) DO NOTHING`,
        [n.org_id, n.kind, n.route, n.supply_id, n.demand_id, n.title_th, n.body_th, n.link_path],
      )) > 0
    );
  },
  listForOrg: (db: Db, orgId: string, limit: number) =>
    many(db, NotificationRow, 'SELECT * FROM notifications WHERE org_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [orgId, limit]),
  unreadCount: async (db: Db, orgId: string): Promise<number> =>
    Number(
      (await maybe(db, z.object({ n: z.string() }), 'SELECT count(*)::text AS n FROM notifications WHERE org_id = $1 AND read_at IS NULL', [orgId]))?.n ?? '0',
    ),
  /** Marks one row read. Returns false when the row is missing or belongs to another organization. */
  async markRead(db: Db, orgId: string, id: string): Promise<boolean> {
    return (
      (await exec(db, 'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND org_id = $2', [id, orgId])) > 0
    );
  },
  markAllRead: (db: Db, orgId: string) =>
    exec(db, 'UPDATE notifications SET read_at = now() WHERE org_id = $1 AND read_at IS NULL', [orgId]),
};
