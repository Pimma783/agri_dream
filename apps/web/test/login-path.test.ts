import { describe, expect, it } from 'vitest';
import { loginPathFor } from '@/lib/login-path';
describe('loginPathFor', () => {
  it('first visit (no cookie) goes to a plain /login without the expired banner flag', () => {
    expect(loginPathFor('')).toBe('/login');
    expect(loginPathFor('theme=dark; other=1')).toBe('/login');
  });
  it('a request that carried a session cookie the API refused gets the expired flag', () => {
    expect(loginPathFor('agrimatch_sid=abc')).toBe('/login?expired=1');
    expect(loginPathFor('theme=dark; agrimatch_sid=abc')).toBe('/login?expired=1');
  });
});
