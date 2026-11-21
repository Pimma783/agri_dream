import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl } from './db-helper.js';

describe('assertTestDatabaseUrl', () => {
  it('accepts a local agrimatch_test URL', () => {
    expect(() => assertTestDatabaseUrl('postgres://u:p@127.0.0.1:5433/agrimatch_test')).not.toThrow();
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost/agrimatch_test')).not.toThrow();
  });
  it.each([
    ['other database name', 'postgres://u:p@127.0.0.1:5433/agrimatch'],
    ['similar suffix only', 'postgres://u:p@127.0.0.1:5433/other_test'],
    ['name with extra suffix', 'postgres://u:p@127.0.0.1:5433/agrimatch_test2'],
    ['remote host', 'postgres://u:p@db.example.com:5432/agrimatch_test'],
    ['no database', 'postgres://u:p@127.0.0.1:5433'],
    ['not a URL', 'nonsense'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertTestDatabaseUrl(url)).toThrow();
  });
  it('refuses a missing URL', () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow();
  });
  it('never echoes the URL it refused', () => {
    try {
      assertTestDatabaseUrl('postgres://user:s3cretpw@127.0.0.1:5433/agrimatch');
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain('s3cretpw');
    }
  });
});
