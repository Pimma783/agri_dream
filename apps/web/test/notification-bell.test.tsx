// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotificationBell } from '@/components/notification-bell';
import { relativeTimeTh } from '@/lib/notifications';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = new Date('2026-11-18T05:00:00Z');
const item = (id: string, read: boolean, createdAt: string) => ({
  id, kind: 'NEW_MATCH' as const, route: 1, title_th: 'มีประกาศใหม่ตรงกับความต้องการของคุณ', body_th: 'ฟางข้าว 5,000 กก. · นครสวรรค์',
  link_path: `/matches/${id}`, created_at: createdAt, read_at: read ? createdAt : null,
});
function fakeApi(list: ReturnType<typeof item>[]) {
  const state = { list, unread: list.filter((n) => n.read_at === null).length };
  const get = vi.fn(async (path: string, schema: { parse: (v: unknown) => unknown }) => {
    expect(path).toBe('/notifications');
    return schema.parse({ items: state.list, unread_count: state.unread });
  });
  const post = vi.fn(async (path: string, schema: { parse: (v: unknown) => unknown }) => {
    if (path.endsWith('/read-all')) state.unread = 0;
    else state.unread = Math.max(0, state.unread - 1);
    return schema.parse({ unread_count: state.unread });
  });
  return { get, post, state };
}

describe('NotificationBell', () => {
  it('shows an accessible bell with the unread count, lists items and marks one read before navigating', async () => {
    const api = fakeApi([item('a', false, '2026-11-18T04:55:00Z'), item('b', true, '2026-11-18T02:00:00Z')]);
    const navigate = vi.fn();
    render(<NotificationBell api={api as never} navigate={navigate} now={() => NOW} />);
    const bell = screen.getByRole('button', { name: 'การแจ้งเตือน' });
    await waitFor(() => expect(screen.getByTestId('notification-badge').textContent).toBe('1'));
    expect(bell.getAttribute('aria-describedby')).toBe('notification-count');
    expect(screen.getByRole('status').textContent).toBe('ยังไม่ได้อ่าน 1 รายการ');
    expect(bell.className).toContain('h-11');

    fireEvent.click(bell);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('5 นาทีที่แล้ว')).toBeTruthy();
    expect(screen.getByText('3 ชั่วโมงที่แล้ว')).toBeTruthy();
    const rows = screen.getAllByText('ฟางข้าว 5,000 กก. · นครสวรรค์').map((e) => e.closest('button')!);
    expect(rows.map((r) => r.getAttribute('data-unread'))).toEqual(['true', 'false']);

    fireEvent.click(rows[0]!);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/matches/a'));
    expect(api.post).toHaveBeenCalledWith('/notifications/a/read', expect.anything());
    await waitFor(() => expect(screen.queryByTestId('notification-badge')).toBeNull());
  });

  it('marks everything read with «อ่านทั้งหมด»', async () => {
    const api = fakeApi([item('a', false, '2026-11-18T04:59:30Z'), item('b', false, '2026-11-18T04:00:00Z')]);
    render(<NotificationBell api={api as never} navigate={vi.fn()} now={() => NOW} />);
    await waitFor(() => expect(screen.getByTestId('notification-badge').textContent).toBe('2'));
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือน' }));
    expect(screen.getByText('เมื่อสักครู่')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'อ่านทั้งหมด' }));
    await waitFor(() => expect(screen.queryByTestId('notification-badge')).toBeNull());
    expect(api.post).toHaveBeenCalledWith('/notifications/read-all', expect.anything());
    expect(screen.getAllByText('ฟางข้าว 5,000 กก. · นครสวรรค์').every((e) => e.closest('button')!.getAttribute('data-unread') === 'false')).toBe(true);
  });

  it('polls every 30 seconds only while the tab is visible', async () => {
    vi.useFakeTimers();
    const api = fakeApi([]);
    render(<NotificationBell api={api as never} navigate={vi.fn()} now={() => NOW} />);
    await act(async () => {});
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.get).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.get).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.get).toHaveBeenCalledTimes(3);
  });
});

describe('relativeTimeTh', () => {
  it('uses Asia/Bangkok date for items older than a day', () => {
    expect(relativeTimeTh('2026-11-16T20:00:00Z', NOW)).toContain('17');
    expect(relativeTimeTh('nope', NOW)).toBe('-');
  });
});
