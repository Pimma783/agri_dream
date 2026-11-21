import { describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, createServiceRegistry, serviceRegistry, type Actor } from '../src/domain/permissions.js';
import { sendAppError, sendResult } from '../src/http/errors.js';
import {
  appError, authorized, checkVersion, ERROR_CODES, ERROR_TABLE, err, httpStatusOf, mapResult, messageThOf, ok,
  registerService, requestHash, stableStringify,
} from '../src/services/index.js';

const farmer: Actor = { userId: 'u', orgId: 'a', role: 'FARMER', channel: 'web' };

describe('service registry', () => {
  it('reports a service registered without a capability', () => {
    const r = createServiceRegistry();
    r.register('ok', CAPABILITIES[0]!);
    r.register('bad', undefined);
    expect(r.undeclared()).toEqual(['bad']);
  });
  it('every service registered in the process declares a capability', () => {
    expect(serviceRegistry.entries().has('media')).toBe(true);
    expect(serviceRegistry.undeclared()).toEqual([]);
  });
  it('registerService records the capability', () => {
    registerService('foundation-test', 'LISTING_CREATE');
    expect(serviceRegistry.entries().get('foundation-test')).toBe('LISTING_CREATE');
  });
});

describe('errors and results', () => {
  it('has a status and Thai message for every code', () => {
    for (const c of ERROR_CODES) {
      expect(ERROR_TABLE[c].status).toBeGreaterThanOrEqual(400);
      expect(ERROR_TABLE[c].messageTh).toMatch(/[\u0E00-\u0E7F]/);
    }
    expect(httpStatusOf(appError('STALE_VERSION'))).toBe(409);
    expect(httpStatusOf(appError('IDEMPOTENCY_MISMATCH'))).toBe(422);
    expect(httpStatusOf(appError('CONFLICT_RETRY'))).toBe(503);
    expect(messageThOf(appError('NOT_FOUND'))).toBe(ERROR_TABLE.NOT_FOUND.messageTh);
  });
  it('maps results', () => {
    expect(mapResult(ok(2), (n) => n * 2)).toEqual(ok(4));
    const e = err(appError('NOT_FOUND'));
    expect(mapResult(e, () => 1)).toBe(e);
  });
  it('checkVersion returns STALE_VERSION with the current version', () => {
    expect(checkVersion(3, 3).ok).toBe(true);
    expect(checkVersion(2, 3)).toEqual(err(appError('STALE_VERSION', { details: { current_version: 3 } })));
  });
});

describe('authorized()', () => {
  it('denies before running fn: role violation FORBIDDEN, cross-org NOT_FOUND', async () => {
    const fn = vi.fn(async () => ok(1));
    const warn = vi.fn();
    const ctx = { logger: { warn } as never };
    expect(await authorized(ctx, { ...farmer, role: 'BUYER_FACTORY' }, 'LISTING_CREATE', undefined, fn)).toEqual(err(appError('FORBIDDEN')));
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('"u"');
    expect(await authorized(ctx, farmer, 'LISTING_MANAGE', { orgId: 'other' }, fn)).toEqual(err(appError('NOT_FOUND')));
    expect(fn).not.toHaveBeenCalled();
    expect(await authorized(ctx, farmer, 'LISTING_MANAGE', { orgId: 'a' }, fn)).toEqual(ok(1));
  });
});

describe('idempotency hashing', () => {
  it('is independent of key order and sensitive to values', () => {
    expect(requestHash({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(requestHash({ b: { d: 'x', c: [1, 2] }, a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('HTTP error mapper', () => {
  function fakeRes() {
    const out: { status?: number; body?: unknown } = {};
    const res = { status(s: number) { out.status = s; return res; }, json(b: unknown) { out.body = b; return res; } };
    return { res: res as never, out };
  }
  it('sends { error: { code, message_th } } with the mapped status', () => {
    const { res, out } = fakeRes();
    sendAppError(res, appError('STALE_VERSION', { details: { current_version: 4 } }));
    expect(out.status).toBe(409);
    expect(out.body).toEqual({ error: { code: 'STALE_VERSION', message_th: ERROR_TABLE.STALE_VERSION.messageTh, details: { current_version: 4 } } });
  });
  it('sendResult sends the value for Ok', () => {
    const { res, out } = fakeRes();
    sendResult(res, ok({ id: 1 }), 201);
    expect(out).toEqual({ status: 201, body: { id: 1 } });
  });
});
