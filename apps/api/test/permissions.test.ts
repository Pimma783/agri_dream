import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  CAPABILITY_MATRIX,
  ROLES,
  authorize,
  createServiceRegistry,
  type Actor,
  type Capability,
  type Role,
} from '../src/domain/permissions.js';

const actor = (role: Role, orgId = 'org-a', channel: Actor['channel'] = 'web'): Actor => ({
  userId: 'u1',
  orgId,
  role,
  channel,
});

describe('capability matrix (spec section 4)', () => {
  it.each([
    ['LISTING_CREATE', ['FARMER', 'BALER']],
    ['DEMAND_CREATE', ['BALER', 'BUYER_FACTORY']],
    ['BALING_SERVICE_PUBLISH', ['BALER']],
    ['BALING_REQUEST_SUBMIT', ['FARMER']],
    ['RESALE_DRAFT_CREATE', ['BALER']],
  ] as const)('%s is allowed only for %j', (cap, allowed) => {
    expect([...CAPABILITY_MATRIX[cap].roles].sort()).toEqual([...allowed].sort());
  });

  it('role violation returns 403 and does not depend on the resource', () => {
    const d = authorize(actor('BUYER_FACTORY'), 'LISTING_CREATE');
    expect(d).toEqual({ allowed: false, status: 403, code: 'FORBIDDEN' });
    expect(authorize(actor('FARMER'), 'BALING_SERVICE_PUBLISH', { orgId: 'other' })).toEqual(d);
  });

  it('cross-org read returns 404, the same as a missing resource', () => {
    const d = authorize(actor('FARMER'), 'LISTING_MANAGE', { orgId: 'org-b' });
    expect(d).toEqual({ allowed: false, status: 404, code: 'NOT_FOUND' });
    expect(authorize(actor('FARMER'), 'LISTING_MANAGE')).toEqual(d);
  });

  it('owner is allowed', () => {
    expect(authorize(actor('FARMER'), 'LISTING_MANAGE', { orgId: 'org-a' })).toEqual({ allowed: true });
  });

  it('offer receiver may read and respond; sender may read and withdraw but not respond', () => {
    const offer = { orgId: 'sender', receiverOrgId: 'recv' };
    const recv = actor('BUYER_FACTORY', 'recv');
    const send = actor('BALER', 'sender');
    expect(authorize(recv, 'OFFER_READ', offer).allowed).toBe(true);
    expect(authorize(recv, 'OFFER_RESPOND', offer).allowed).toBe(true);
    expect(authorize(recv, 'OFFER_WITHDRAW', offer).allowed).toBe(false);
    expect(authorize(send, 'OFFER_WITHDRAW', offer).allowed).toBe(true);
    expect(authorize(send, 'OFFER_RESPOND', offer)).toMatchObject({ status: 404 });
  });

  it('published view is readable only by matched orgs', () => {
    const r = { orgId: 'o', published: true, matchedOrgIds: ['org-a'] };
    expect(authorize(actor('FARMER'), 'PUBLISHED_VIEW_READ', r).allowed).toBe(true);
    expect(authorize(actor('FARMER', 'org-z'), 'PUBLISHED_VIEW_READ', r).allowed).toBe(false);
    expect(authorize(actor('FARMER'), 'PUBLISHED_VIEW_READ', { ...r, published: false }).allowed).toBe(false);
  });

  it('a LINE channel whose role differs from the actor role is forbidden', () => {
    expect(authorize(actor('FARMER', 'org-a', 'line:factory'), 'CHAT_ASSISTANT')).toMatchObject({ status: 403 });
  });

  it('property: allowed iff role listed and resource rule holds', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROLES),
        fc.constantFrom<Capability>(...CAPABILITIES),
        fc.constantFrom('org-a', 'org-b'),
        (role, cap, resOrg) => {
          const d = authorize(actor(role), cap, { orgId: resOrg, receiverOrgId: 'org-b' });
          const rule = CAPABILITY_MATRIX[cap];
          const roleOk = (rule.roles as readonly Role[]).includes(role);
          if (!roleOk) return !d.allowed && d.status === 403;
          if (d.allowed) return true;
          return d.status === 404;
        },
      ),
    );
  });
});

describe('service registry', () => {
  it('reports services without a declared capability', () => {
    const reg = createServiceRegistry();
    reg.register('createListing', 'LISTING_CREATE');
    reg.register('forgotten', undefined);
    expect(reg.undeclared()).toEqual(['forgotten']);
    expect(reg.entries().get('createListing')).toBe('LISTING_CREATE');
  });
});
