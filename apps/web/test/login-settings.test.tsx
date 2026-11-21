// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LineLinkCodeResponse } from '@agrimatch/contracts';
import { LoginForm } from '@/components/login-form';
import { LineLinkPanel } from '@/components/line-link-panel';
import { LogoutButton } from '@/components/logout-button';
import { ApiRequestError, SessionExpiredError } from '@/lib/api-core';
import { CHANNEL_OF_ROLE } from '@/lib/line-link';
import { navForRole } from '@/lib/nav';

afterEach(cleanup);

const fill = (email = 'a@example.invalid', password = 'pw') => {
  fireEvent.change(screen.getByLabelText('อีเมล'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: password } });
};
const res = (status: number) => new Response(status === 204 ? null : '{}', { status });

describe('LoginForm', () => {
  it('posts to /api/auth/login and calls onSuccess on 204', async () => {
    const fetchImpl = vi.fn(async () => res(204)) as unknown as typeof fetch;
    const onSuccess = vi.fn();
    render(<LoginForm fetchImpl={fetchImpl} onSuccess={onSuccess} />);
    fill('  a@example.invalid ', 'secret');
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@example.invalid', password: 'secret' });
  });
  it.each([
    [401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'],
    [429, 'ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'],
    [500, 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่'],
  ])('shows a generic Thai alert for status %i and stays on the form', async (status, text) => {
    const onSuccess = vi.fn();
    render(<LoginForm fetchImpl={(async () => res(status)) as unknown as typeof fetch} onSuccess={onSuccess} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    expect((await screen.findByRole('alert')).textContent).toBe(text);
    expect(onSuccess).not.toHaveBeenCalled();
  });
  it('shows a connection error when the request fails', async () => {
    render(<LoginForm fetchImpl={(async () => { throw new Error('down'); }) as unknown as typeof fetch} onSuccess={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    expect((await screen.findByRole('alert')).textContent).toBe('เชื่อมต่อไม่ได้ กรุณาลองใหม่');
  });
  it('shows the session-expired banner only when expired, and disables submit until both fields are filled', () => {
    const { rerender } = render(<LoginForm />);
    expect(screen.queryByText('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง')).toBeNull();
    expect((screen.getByRole('button', { name: 'เข้าสู่ระบบ' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<LoginForm expired />);
    expect(screen.getByText('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง')).toBeTruthy();
  });
  it('uses 44px touch targets and masks the password', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText('รหัสผ่าน').getAttribute('type')).toBe('password');
    expect(screen.getByLabelText('อีเมล').className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }).className).toContain('min-h-11');
  });
});

describe('LineLinkPanel', () => {
  const issued: LineLinkCodeResponse = { channel: 'baler', code: 'ABCD2345', expires_at: '2030-01-01T03:10:00.000Z', basic_id: '@oa-synthetic' };
  it('shows the link status and no code before generation', () => {
    render(<LineLinkPanel channel="baler" linked={false} basicId={null} />);
    expect(screen.getByTestId('link-status').getAttribute('data-status')).toBe('UNLINKED');
    expect(screen.queryByTestId('link-code')).toBeNull();
  });
  it('shows a linked status', () => {
    render(<LineLinkPanel channel="farmer" linked basicId={null} />);
    expect(screen.getByTestId('link-status').textContent).toBe('เชื่อมแล้ว');
  });
  it('generates a code and shows it with expiry (Bangkok time), Basic ID and instructions', async () => {
    const issueCode = vi.fn(async () => issued);
    render(<LineLinkPanel channel="baler" linked={false} basicId={null} issueCode={issueCode} />);
    fireEvent.click(screen.getByRole('button', { name: 'สร้างรหัสผูกบัญชี' }));
    expect((await screen.findByTestId('link-code')).textContent).toBe('ABCD2345');
    expect(issueCode).toHaveBeenCalledWith('baler');
    expect(screen.getByTestId('link-expiry').textContent).toContain('10:10');
    expect(screen.getByTestId('basic-id').textContent).toBe('@oa-synthetic');
    expect(screen.getByText('พิมพ์รหัสนี้ส่งในแชท')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'สร้างรหัสใหม่' })).toBeTruthy();
  });
  it('falls back to the configured Basic ID and omits it when none is configured', async () => {
    const noBasic = vi.fn(async () => ({ ...issued, basic_id: null }));
    const { unmount } = render(<LineLinkPanel channel="baler" linked={false} basicId="@from-config" issueCode={noBasic} />);
    fireEvent.click(screen.getByRole('button', { name: 'สร้างรหัสผูกบัญชี' }));
    expect((await screen.findByTestId('basic-id')).textContent).toBe('@from-config');
    unmount();
    render(<LineLinkPanel channel="baler" linked={false} basicId={null} issueCode={noBasic} />);
    fireEvent.click(screen.getByRole('button', { name: 'สร้างรหัสผูกบัญชี' }));
    await screen.findByTestId('link-code');
    expect(screen.queryByTestId('basic-id')).toBeNull();
  });
  it('shows a generic Thai error without any code when generation fails', async () => {
    const issueCode = vi.fn(async () => { throw new ApiRequestError(403, 'FORBIDDEN', 'raw server text'); });
    render(<LineLinkPanel channel="baler" linked={false} basicId={null} issueCode={issueCode} />);
    fireEvent.click(screen.getByRole('button', { name: 'สร้างรหัสผูกบัญชี' }));
    expect((await screen.findByRole('alert')).textContent).toBe('ไม่สามารถสร้างรหัสผูกบัญชีได้');
    expect(screen.queryByTestId('link-code')).toBeNull();
  });
  it('sends the user to /login?expired=1 when the session has expired', async () => {
    const navigate = vi.fn();
    const issueCode = vi.fn(async () => { throw new SessionExpiredError(); });
    render(<LineLinkPanel channel="baler" linked={false} basicId={null} issueCode={issueCode} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'สร้างรหัสผูกบัญชี' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login?expired=1'));
  });
  it('replaces the previous code when a new one is generated', async () => {
    const codes = ['AAAA2222', 'BBBB3333'];
    const issueCode = vi.fn(async () => ({ ...issued, code: codes.shift()! }));
    render(<LineLinkPanel channel="baler" linked={false} basicId={null} issueCode={issueCode} />);
    fireEvent.click(screen.getByRole('button', { name: 'สร้างรหัสผูกบัญชี' }));
    await screen.findByText('AAAA2222');
    fireEvent.click(screen.getByRole('button', { name: 'สร้างรหัสใหม่' }));
    await screen.findByText('BBBB3333');
    expect(screen.queryByText('AAAA2222')).toBeNull();
  });
});

describe('LogoutButton and nav', () => {
  it('logs out then goes to /login', async () => {
    const logout = vi.fn(async () => undefined);
    const navigate = vi.fn();
    render(<LogoutButton logout={logout} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'));
  });
  it('shows an error when logout fails', async () => {
    render(<LogoutButton logout={async () => { throw new Error('x'); }} navigate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('ออกจากระบบไม่สำเร็จ');
  });
  it('has a ready settings item for every role and one channel per role', () => {
    for (const role of ['FARMER', 'BALER', 'FACTORY'] as const) {
      const item = navForRole(role).find((i) => i.href === '/settings/line');
      expect(item?.ready).toBe(true);
    }
    expect(CHANNEL_OF_ROLE).toEqual({ FARMER: 'farmer', BALER: 'baler', FACTORY: 'factory' });
  });
});
