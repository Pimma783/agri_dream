import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { backoffDelayMs, SweeperSchedule } from '../src/jobs/index.js';

const policy = { baseMs: 1000, capMs: 60_000 };

describe('backoffDelayMs', () => {
  it('stays within [step/2, step] and never exceeds the cap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.double({ min: 0, max: 0.999999, noNaN: true }), (attempts, r) => {
        const step = Math.min(policy.capMs, policy.baseMs * 2 ** (attempts - 1));
        const d = backoffDelayMs(attempts, policy, () => r);
        expect(d).toBeGreaterThanOrEqual(Math.floor(step / 2));
        expect(d).toBeLessThanOrEqual(step);
        expect(d).toBeLessThanOrEqual(policy.capMs);
      }),
    );
  });
  it('grows with attempts when jitter is fixed', () => {
    const ds = [1, 2, 3, 4].map((n) => backoffDelayMs(n, policy, () => 0));
    expect(ds).toEqual([500, 1000, 2000, 4000]);
  });
});

describe('FakeLineClient', () => {
  const msg = [{ type: 'text', text: 'hi' }];
  it('is kind mock and records channel, token, recipient and retry key', async () => {
    const line = new FakeLineClient({ baler: 'synthetic-baler-token' });
    expect(line.kind).toBe('mock');
    await line.forChannel('baler').push({ to: 'U1', messages: msg, retryKey: 'k1' });
    expect(line.pushes).toEqual([{ channel: 'baler', token: 'synthetic-baler-token', to: 'U1', messages: msg, retryKey: 'k1', accepted: true }]);
  });
  it('treats a repeated retry key as an already accepted duplicate', async () => {
    const line = new FakeLineClient();
    const c = line.forChannel('farmer');
    expect(await c.push({ to: 'U1', messages: msg, retryKey: 'k' })).toEqual({ ok: true, duplicate: false });
    expect(await c.push({ to: 'U1', messages: msg, retryKey: 'k' })).toEqual({ ok: true, duplicate: true });
    expect(line.delivered).toHaveLength(1);
  });
  it('replays scripted failures in order', async () => {
    const line = new FakeLineClient();
    line.failNext({ ok: false, code: 'RATE_LIMITED', retryAfterMs: 5 });
    const c = line.forChannel('factory');
    expect(await c.push({ to: 'U', messages: msg, retryKey: 'a' })).toEqual({ ok: false, code: 'RATE_LIMITED', retryAfterMs: 5 });
    expect((await c.push({ to: 'U', messages: msg, retryKey: 'a' })).ok).toBe(true);
  });
});

describe('SweeperSchedule', () => {
  it('runs a sweeper once per interval and survives a failing one', async () => {
    let t = 0;
    const clock = { now: () => new Date(t), random: () => 0 };
    let ok = 0;
    const s = new SweeperSchedule(
      [
        { name: 'bad', intervalMs: 1000, run: async () => { throw new Error('x'); } },
        { name: 'expire_offers', intervalMs: 60_000, run: async () => { ok++; } },
      ],
      clock,
    );
    expect(await s.tick()).toEqual(['expire_offers']);
    t = 30_000;
    expect(await s.tick()).toEqual([]);
    t = 60_000;
    expect(await s.tick()).toEqual(['expire_offers']);
    expect(ok).toBe(2);
  });
});
