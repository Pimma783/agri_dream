// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(screen.getByRole('link', { name: 'เพิ่มเพื่อนใน LINE' }).getAttribute('href')).toBe('https://line.me/R/ti/p/@642ctpqm');
    expect(document.querySelector('input[type=password]')).toBeNull();
    expect(screen.getByRole('link', { name: /กลับ/ }).getAttribute('href')).toBe('/login');
  });
  it('factory: login form plus factory QR and link', () => {
    render(<LoginGate role="factory" />);
    expect(document.querySelector('input[type=password]')).not.toBeNull();
    expect(screen.getByTestId('line-qr')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'เพิ่มเพื่อนใน LINE' }).getAttribute('href')).toBe('https://line.me/R/ti/p/@241sxehz');
    expect(screen.getByRole('link', { name: /กลับ/ }).getAttribute('href')).toBe('/login');
  });
  it('role query parsing: invalid falls back to chooser', () => {
    expect(parseRole('farmer')).toBe('farmer');
    expect(parseRole('factory')).toBe('factory');
    expect(parseRole('admin')).toBeNull();
    expect(parseRole(['farmer'])).toBeNull();
    expect(parseRole(undefined)).toBeNull();
  });
});
