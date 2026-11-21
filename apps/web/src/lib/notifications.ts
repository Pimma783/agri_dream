import { notificationListSchema, notificationUnreadSchema, type NotificationListDto, type NotificationUnreadDto } from '@agrimatch/contracts';
import { browserApi } from './api';
import type { ApiCore } from './api-core';
import { formatDateTime } from './format';

export type NotificationsApi = Pick<ApiCore, 'get' | 'post'>;
export const NOTIFICATION_POLL_MS = 30_000;

export const defaultNotificationsApi: NotificationsApi = browserApi;
export const fetchNotifications = (api: NotificationsApi): Promise<NotificationListDto> => api.get('/notifications', notificationListSchema);
export const markNotificationRead = (api: NotificationsApi, id: string): Promise<NotificationUnreadDto> =>
  api.post(`/notifications/${encodeURIComponent(id)}/read`, notificationUnreadSchema);
export const markAllNotificationsRead = (api: NotificationsApi): Promise<NotificationUnreadDto> =>
  api.post('/notifications/read-all', notificationUnreadSchema);

/** "เมื่อสักครู่", "5 นาทีที่แล้ว", "3 ชั่วโมงที่แล้ว"; older than a day shows the Asia/Bangkok date and time. */
export function relativeTimeTh(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '-';
  const sec = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (sec < 60) return 'เมื่อสักครู่';
  if (sec < 3600) return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} ชั่วโมงที่แล้ว`;
  return formatDateTime(iso);
}
