// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import StartPage from '@/app/start/page';

afterEach(cleanup);
describe('/start chooser', () => {
  it('offers the prototype and the presentation', () => {
    render(<StartPage />);
    expect(screen.getByRole('link', { name: 'เข้าสู่ต้นแบบ' }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: 'เปิดการนำเสนอ' }).getAttribute('href')).toBe('/story');
  });
});
