// Feature: agrimatch-mvp, Property 14: Permission checks hold for every actor, resource and channel
// Pure matrix part. The database-unchanged part is task 6.4.
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 14.4
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  authorize,
  createServiceRegistry,
  type Actor,
  type Capability,
  type Channel,
  type Resource,
  type Role,
} from '../src/domain/permissions.js';

const NUM_RUNS = 200;

type Access = 'none' | 'owner' | 'receiver' | 'owner_or_receiver' | 'published_view';

// Independent oracle, written from docs/AGRIMATCH_MVP_SPEC.md section 4 (not read from CAPABILITY_MATRIX).
const F: Role = 'FARMER';
const B: Role = 'BALER';
const X: Role = 'BUYER_FACTORY';
const ORACLE: Record<Capability, { roles: Role[]; access: Access }> = {
  CHAT_ASSISTANT: { roles: [F, B, X], access: 'none' },
  LISTING_CREATE: { roles: [F, B], access: 'none' },
  LISTING_MANAGE: { roles: [F, B], access: 'owner' },
  DEMAND_CREATE: { roles: [B, X], access: 'none' },
  DEMAND_MANAGE: { roles: [B, X], access: 'owner' },
  BALING_SERVICE_PUBLISH: { roles: [B], access: 'none' },
  BALING_SERVICE_MANAGE: { roles: [B], access: 'owner' },
  BALING_SERVICE_SEARCH: { roles: [F], access: 'none' },
  BALING_SERVICE_VIEW_OWN: { roles: [B], access: 'owner' },
  BALING_REQUEST_SUBMIT: { roles: [F], access: 'none' },
  OFFER_SEND: { roles: [F, B, X], access: 'none' },
  OFFER_READ: { roles: [F, B, X], access: 'owner_or_receiver' },
  OFFER_RESPOND: { roles: [F, B, X], access: 'receiver' },
  OFFER_WITHDRAW: { roles: [F, B, X], access: 'owner' },
  PUBLISHED_VIEW_READ: { roles: [F, B, X], access: 'published_view' },
  DASHBOARD_MANAGE: { roles: [B, X], access: 'none' },
  RESALE_DRAFT_CREATE: { roles: [B], access: 'owner' },
};

const CHANNEL_ROLE: Partial<Record<Channel, Role>> = {
  'line:farmer': F,
  'line:baler': B,
  'line:factory': X,
};

const roleArb = fc.constantFrom<Role>(F, B, X);
const channelArb = fc.constantFrom<Channel>('line:farmer', 'line:baler', 'line:factory', 'web', 'assistant');
const capArb = fc.constantFrom<Capability>(...CAPABILITIES);
const orgArb = fc.constantFrom('org-1', 'org-2', 'org-3', 'org-4');

const actorArb: fc.Arbitrary<Actor> = fc.record({
  userId: fc.constantFrom('u1', 'u2'),
  orgId: orgArb,
  role: roleArb,
  channel: channelArb,
});

const resourceArb: fc.Arbitrary<Resource> = fc.record(
  {
    orgId: orgArb,
    receiverOrgId: orgArb,
    published: fc.boolean(),
    matchedOrgIds: fc.array(orgArb, { maxLength: 4 }),
  },
  { requiredKeys: ['orgId'] },
);

function expected(actor: Actor, cap: Capability, res?: Resource): 'ALLOW' | 403 | 404 {
  const rule = ORACLE[cap];
  if (!rule.roles.includes(actor.role)) return 403;
  const chRole = CHANNEL_ROLE[actor.channel];
  if (chRole !== undefined && chRole !== actor.role) return 403;
  if (rule.access === 'none') return 'ALLOW';
  if (res === undefined) return 404;
  const owner = res.orgId === actor.orgId;
  const receiver = res.receiverOrgId !== undefined && res.receiverOrgId === actor.orgId;
  const ok =
    rule.access === 'owner'
      ? owner
      : rule.access === 'receiver'
        ? receiver
        : rule.access === 'owner_or_receiver'
          ? owner || receiver
          : owner || (res.published === true && (res.matchedOrgIds ?? []).includes(actor.orgId));
  return ok ? 'ALLOW' : 404;
}

describe('Property 14: permissions (pure matrix)', () => {
  it('oracle covers exactly the declared capabilities', () => {
    expect([...CAPABILITIES].sort()).toEqual(Object.keys(ORACLE).sort());
  });

  it('decision equals the spec-section-4 oracle for any actor, capability, resource and channel', () => {
    fc.assert(
      fc.property(actorArb, capArb, fc.option(resourceArb, { nil: undefined }), (actor, cap, res) => {
        const d = authorize(actor, cap, res);
        const e = expected(actor, cap, res);
        if (e === 'ALLOW') return d.allowed === true;
        return d.allowed === false && d.status === e;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('role violation is 403 whatever the resource, and never leaks via 404', () => {
    fc.assert(
      fc.property(actorArb, capArb, fc.option(resourceArb, { nil: undefined }), (actor, cap, res) => {
        fc.pre(!ORACLE[cap].roles.includes(actor.role));
        const d = authorize(actor, cap, res);
        return !d.allowed && d.status === 403 && d.code === 'FORBIDDEN';
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('cross-org resource gets the same decision as a missing resource (404, never 403)', () => {
    fc.assert(
      fc.property(actorArb, capArb, resourceArb, (actor, cap, res) => {
        const rule = ORACLE[cap];
        fc.pre(rule.access !== 'none');
        fc.pre(rule.roles.includes(actor.role));
        fc.pre(CHANNEL_ROLE[actor.channel] === undefined || CHANNEL_ROLE[actor.channel] === actor.role);
        // Resource unreachable for this actor's org.
        const foreign: Resource = {
          orgId: res.orgId === actor.orgId ? 'org-foreign' : res.orgId,
          ...(res.receiverOrgId !== undefined && {
            receiverOrgId: res.receiverOrgId === actor.orgId ? 'org-foreign-2' : res.receiverOrgId,
          }),
          ...(res.published !== undefined && { published: res.published }),
          matchedOrgIds: (res.matchedOrgIds ?? []).filter((o) => o !== actor.orgId),
        };
        const d = authorize(actor, cap, foreign);
        const missing = authorize(actor, cap);
        return !d.allowed && d.status === 404 && d.code === 'NOT_FOUND' && JSON.stringify(d) === JSON.stringify(missing);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('LINE channel/role mismatch is 403 for every capability, resource and org', () => {
    fc.assert(
      fc.property(actorArb, capArb, fc.option(resourceArb, { nil: undefined }), (actor, cap, res) => {
        const chRole = CHANNEL_ROLE[actor.channel];
        fc.pre(chRole !== undefined && chRole !== actor.role);
        const d = authorize(actor, cap, res);
        return !d.allowed && d.status === 403;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('web and assistant channels decide identically to a matching LINE channel', () => {
    const lineFor: Record<Role, Channel> = {
      FARMER: 'line:farmer',
      BALER: 'line:baler',
      BUYER_FACTORY: 'line:factory',
    };
    fc.assert(
      fc.property(actorArb, capArb, fc.option(resourceArb, { nil: undefined }), (actor, cap, res) => {
        const line = authorize({ ...actor, channel: lineFor[actor.role] }, cap, res);
        const web = authorize({ ...actor, channel: 'web' }, cap, res);
        const bot = authorize({ ...actor, channel: 'assistant' }, cap, res);
        return JSON.stringify(line) === JSON.stringify(web) && JSON.stringify(web) === JSON.stringify(bot);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('unknown or prototype-chain capability names are forbidden', () => {
    fc.assert(
      fc.property(
        actorArb,
        fc.oneof(
          fc.constantFrom('constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'),
          fc.string().filter((s) => !CAPABILITIES.includes(s as Capability)),
        ),
        (actor, name) => {
          const d = authorize(actor, name as Capability, { orgId: actor.orgId });
          return !d.allowed && d.status === 403;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 14: service registry', () => {
  const nameArb = fc.string({ minLength: 1, maxLength: 12 });

  it('undeclared() lists exactly the services with no valid capability', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            name: nameArb,
            cap: fc.oneof(
              capArb,
              fc.constant(undefined),
              fc.constantFrom('constructor', 'NOPE', '__proto__') as unknown as fc.Arbitrary<Capability>,
            ),
          }),
          { selector: (s) => s.name, maxLength: 15 },
        ),
        (services) => {
          const reg = createServiceRegistry();
          for (const s of services) reg.register(s.name, s.cap);
          const want = services
            .filter((s) => s.cap === undefined || !CAPABILITIES.includes(s.cap))
            .map((s) => s.name)
            .sort();
          return JSON.stringify(reg.undeclared().sort()) === JSON.stringify(want);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is empty when every service declares a capability', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.tuple(nameArb, capArb), { selector: (t) => t[0] }), (list) => {
        const reg = createServiceRegistry();
        for (const [n, c] of list) reg.register(n, c);
        return reg.undeclared().length === 0;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a service registered without a capability is reported even after others register', () => {
    const reg = createServiceRegistry();
    reg.register('ok', 'LISTING_CREATE');
    reg.register('missing', undefined);
    reg.register('ok2', 'OFFER_SEND');
    expect(reg.undeclared()).toEqual(['missing']);
  });
});
