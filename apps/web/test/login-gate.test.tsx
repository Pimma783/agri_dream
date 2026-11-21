// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginGate } from '@/components/login-gate';
import { parseRole } from '@/lib/line-oa';

afterEach(cleanup);

describe('LoginGate', () => {
  it('chooser shows both buttons and no form', () => {
    render(<LoginGate role={null} />);
    expect(screen.getByRole('link', { name: /เกษตรกร/ }).getAttribute('href')).toBe('/login?role=farmer');
    expect(screen.getByRole('link', { name: /โรงงาน \/ ผู้รับซื้อ/ }).getAttribute('href')).toBe('/login?role=factory');
    expect(document.querySelector('form')).toBeNull();
  });
  it('farmer: QR svg, add-friend link, no password field, back to chooser', () => {
    render(<LoginGate role="farmer" />);
    expect(screen.getByTestId('line-qr').tagName.toLowerCase()).toBe('svg');
    expect(screen.getByRole('link', { name: /เพิ่มเพื่อนใน LINE/ }).getAttribute('href')).toBe('https://line.me/R/ti/p/@642ctpqm');
    expect(document.querySelector('input[type=password]')).toBeNull();
    expect(screen.getByRole('link', { name: /กลับ/ }).getAttribute('href')).toBe('/login');
  });
  it('factory: login form plus factory QR and link', () => {
    render(<LoginGate role="factory" />);
    expect(document.querySelector('input[type=password]')).not.toBeNull();
    expect(screen.getByTestId('line-qr')).toBeTruthy();
    expect(screen.getByRole('link', { name: /เพิ่มเพื่อนใน LINE/ }).getAttribute('href')).toBe('https://line.me/R/ti/p/@241sxehz');
    expect(screen.getByRole('link', { name: /กลับ/ }).getAttribute('href')).toBe('/login');
  });
  it('chooser and farmer view are bilingual and show no credentials', () => {
    const { unmount } = render(<LoginGate role={null} judge={{ email: 'j@x.test', password: 'pw' }} />);
    expect(screen.getByText('Farmer')).toBeTruthy();
    expect(screen.getByText('Factory / Buyer')).toBeTruthy();
    expect(screen.queryByTestId('judge-box')).toBeNull();
    unmount();
    render(<LoginGate role="farmer" judge={{ email: 'j@x.test', password: 'pw' }} />);
    expect(screen.getAllByText(/Add friend/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Back/ })).toBeTruthy();
    expect(screen.queryByTestId('judge-box')).toBeNull();
    expect(document.body.textContent).not.toContain('j@x.test');
  });
  it('factory: shows bilingual judge box, hides it without credentials', () => {
    const { unmount } = render(<LoginGate role="factory" judge={{ email: 'j@x.test', password: 'pw-1' }} />);
    expect(screen.getByText('บัญชีโรงงานสำหรับกรรมการ', { exact: false })).toBeTruthy();
    expect(screen.getByText('Factory demo account for judges')).toBeTruthy();
    expect(screen.getByTestId('judge-email').textContent).toBe('j@x.test');
    expect(screen.getByTestId('judge-password').textContent).toBe('pw-1');
    expect(screen.getAllByRole('button', { name: /Copy/ })).toHaveLength(2);
    unmount();
    render(<LoginGate role="factory" judge={null} />);
    expect(screen.queryByTestId('judge-box')).toBeNull();
  });
  it('copy button writes to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<LoginGate role="factory" judge={{ email: 'j@x.test', password: 'pw-1' }} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Copy/ })[0]!);
    expect(writeText).toHaveBeenCalledWith('j@x.test');
  });
  it('fill-in button fills the login fields', () => {
    render(<LoginGate role="factory" judge={{ email: 'j@x.test', password: 'pw-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Fill in/ }));
    expect((screen.getByLabelText('อีเมล') as HTMLInputElement).value).toBe('j@x.test');
    expect((screen.getByLabelText('รหัสผ่าน') as HTMLInputElement).value).toBe('pw-1');
  });
  it('login page reads the env per request and only passes it in the factory view', async () => {
    vi.resetModules();
    vi.doMock('@/lib/api-server', () => ({ serverApi: async () => ({ getMe: async () => null }) }));
    const { default: LoginPage } = await import('@/app/login/page');
    process.env.JUDGE_DEMO_EMAIL = 'j@x.test';
    process.env.JUDGE_DEMO_PASSWORD = 'pw-1';
    let el = await LoginPage({ searchParams: Promise.resolve({ role: 'factory' }) });
    type N = { props: { role?: unknown; judge?: unknown; children?: N | N[] } };
    const gate = (el0: unknown): N => {
      const n = el0 as N;
      const kids = ([] as N[]).concat(n.props.children ?? []);
      return kids.find(c => c?.props?.role !== undefined)!;
    };
    expect(gate(el).props.judge).toEqual({ email: 'j@x.test', password: 'pw-1' });
    el = await LoginPage({ searchParams: Promise.resolve({ role: 'farmer' }) });
    expect(gate(el).props.judge).toBeNull();
    delete process.env.JUDGE_DEMO_PASSWORD;
    el = await LoginPage({ searchParams: Promise.resolve({ role: 'factory' }) });
    expect(gate(el).props.judge).toBeNull();
    delete process.env.JUDGE_DEMO_EMAIL;
    vi.doUnmock('@/lib/api-server');
  });
  it('role query parsing: invalid falls back to chooser', () => {
    expect(parseRole('farmer')).toBe('farmer');
    expect(parseRole('factory')).toBe('factory');
    expect(parseRole('admin')).toBeNull();
    expect(parseRole(['farmer'])).toBeNull();
    expect(parseRole(undefined)).toBeNull();
  });
});
