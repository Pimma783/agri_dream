import { describe, expect, it } from 'vitest';
import {
  generateLinkCode, LINK_CODE_ALPHABET, LINK_CODE_LENGTH, normalizeLinkCode,
} from '../src/services/identity/index.js';

describe('link code format', () => {
  it('uses 8 characters from an alphabet without look-alikes', () => {
    for (const bad of '01OIL') expect(LINK_CODE_ALPHABET).not.toContain(bad);
    for (let i = 0; i < 200; i++) {
      const c = generateLinkCode();
      expect(c).toHaveLength(LINK_CODE_LENGTH);
      expect([...c].every((ch) => LINK_CODE_ALPHABET.includes(ch))).toBe(true);
    }
  });
  it('normalizes case, spaces and hyphens and rejects other shapes', () => {
    expect(normalizeLinkCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeLinkCode('ABCD 2345')).toBe('ABCD2345');
    expect(normalizeLinkCode('ABCD234')).toBeNull();
    expect(normalizeLinkCode('ABCD2340')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeLinkCode('สวัสดี')).toBeNull();
  });
});
