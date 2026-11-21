// Layer: services. In-app notifications for Dashboard organizations (task 23.1, Requirements 9, 15, 16).
// Authorization: DASHBOARD_MANAGE (balers and factories). Every query is scoped to the actor's own organization,
// so another organization's notification id is indistinguishable from a missing one (NOT_FOUND).
import { z } from 'zod';
import { notifications, type Notification } from '../../repos/index.js';
import type { Actor } from '../../domain/permissions.js';
import { authorized, registerService, type ServiceContext } from '../context.js';
import { appError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

registerService('notifications', 'DASHBOARD_MANAGE');

export const NOTIFICATION_LIST_LIMIT = 50;

export interface NotificationView {
  id: string;
  kind: 'NEW_MATCH';
  route: number;
  title_th: string;
  body_th: string;
  link_path: string;
  created_at: string;
  read_at: string | null;
}
export interface NotificationList {
  items: NotificationView[];
  unread_count: number;
}

const toView = (n: Notification): NotificationView => ({
  id: n.id, kind: n.kind, route: n.route, title_th: n.title_th, body_th: n.body_th, link_path: n.link_path,
  created_at: n.created_at.toISOString(), read_at: n.read_at ? n.read_at.toISOString() : null,
});

export interface NotificationService {
  list(actor: Actor): Promise<Result<NotificationList>>;
  markRead(actor: Actor, id: string): Promise<Result<{ unread_count: number }>>;
  markAllRead(actor: Actor): Promise<Result<{ unread_count: number }>>;
}

export function createNotificationService(ctx: ServiceContext): NotificationService {
  return {
    list: (actor) =>
      authorized(ctx, actor, 'DASHBOARD_MANAGE', undefined, async () => {
        const [rows, unread] = await Promise.all([
          notifications.listForOrg(ctx.pool, actor.orgId, NOTIFICATION_LIST_LIMIT),
          notifications.unreadCount(ctx.pool, actor.orgId),
        ]);
        return ok({ items: rows.map(toView), unread_count: unread });
      }),
    markRead: (actor, id) =>
      authorized(ctx, actor, 'DASHBOARD_MANAGE', undefined, async () => {
        if (!z.uuid().safeParse(id).success) return err(appError('NOT_FOUND'));
        if (!(await notifications.markRead(ctx.pool, actor.orgId, id))) return err(appError('NOT_FOUND'));
        return ok({ unread_count: await notifications.unreadCount(ctx.pool, actor.orgId) });
      }),
    markAllRead: (actor) =>
      authorized(ctx, actor, 'DASHBOARD_MANAGE', undefined, async () => {
        await notifications.markAllRead(ctx.pool, actor.orgId);
        return ok({ unread_count: 0 });
      }),
  };
}
