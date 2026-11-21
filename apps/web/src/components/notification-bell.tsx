'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationDto } from '@agrimatch/contracts';
import { SessionExpiredError } from '@/lib/api-core';
import {
  defaultNotificationsApi, fetchNotifications, markAllNotificationsRead, markNotificationRead, NOTIFICATION_POLL_MS,
  relativeTimeTh, type NotificationsApi,
} from '@/lib/notifications';

export interface NotificationBellProps {
  api?: NotificationsApi;
  pollMs?: number;
  navigate?: (path: string) => void;
  now?: () => Date;
}

/** Bell with an unread badge for Dashboard organizations. Polls while the tab is visible. */
export function NotificationBell({ api = defaultNotificationsApi, pollMs = NOTIFICATION_POLL_MS, navigate, now = () => new Date() }: NotificationBellProps) {
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const stopped = useRef(false);
  const go = navigate ?? ((p: string) => window.location.assign(p));

  const refresh = useCallback(async () => {
    if (stopped.current) return;
    try {
      const r = await fetchNotifications(api);
      setItems(r.items);
      setUnread(r.unread_count);
      setFailed(false);
    } catch (e) {
      if (e instanceof SessionExpiredError) stopped.current = true; // the page redirects on its own requests
      else setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    stopped.current = false;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, pollMs]);

  async function openItem(n: NotificationDto) {
    if (n.read_at === null) {
      try {
        const r = await markNotificationRead(api, n.id);
        setUnread(r.unread_count);
      } catch {
        // Navigation still works when marking fails; the next poll corrects the count.
      }
    }
    go(n.link_path);
  }
  async function readAll() {
    try {
      const r = await markAllNotificationsRead(api);
      setUnread(r.unread_count);
      const at = now().toISOString();
      setItems((cur) => cur.map((n) => (n.read_at === null ? { ...n, read_at: at } : n)));
    } catch {
      setFailed(true);
    }
  }

  const at = now();
  return (
    <div className="relative shrink-0">
      <button
        type="button" aria-label="การแจ้งเตือน" aria-describedby="notification-count" aria-expanded={open} aria-haspopup="dialog"
        onClick={() => { setOpen((o) => !o); if (!open) void refresh(); }}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 ? (
          <span data-testid="notification-badge" aria-hidden="true" className="absolute right-0 top-0 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold leading-5 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      <span id="notification-count" role="status" className="sr-only">
        {unread > 0 ? `ยังไม่ได้อ่าน ${unread} รายการ` : 'ไม่มีการแจ้งเตือนใหม่'}
      </span>
      {open ? (
        <div role="dialog" aria-label="การแจ้งเตือน" className="absolute right-0 top-12 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-1">
            <h2 className="text-base font-semibold">การแจ้งเตือน</h2>
            <button type="button" onClick={readAll} disabled={unread === 0} className="min-h-11 px-2 text-sm font-medium text-emerald-800 disabled:text-slate-400">
              อ่านทั้งหมด
            </button>
          </div>
          {failed ? <p className="px-3 py-2 text-sm text-red-700">โหลดการแจ้งเตือนไม่สำเร็จ</p> : null}
          {items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-600">ยังไม่มีการแจ้งเตือน</p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button" onClick={() => void openItem(n)} data-unread={n.read_at === null ? 'true' : 'false'}
                    className={`block min-h-11 w-full px-3 py-2 text-left hover:bg-slate-50 ${n.read_at === null ? 'bg-emerald-50' : ''}`}
                  >
                    <span className={`block break-words text-sm ${n.read_at === null ? 'font-semibold' : ''}`}>{n.title_th}</span>
                    <span className="block break-words text-sm text-slate-700">{n.body_th}</span>
                    <span className="block text-xs text-slate-500">{relativeTimeTh(n.created_at, at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
