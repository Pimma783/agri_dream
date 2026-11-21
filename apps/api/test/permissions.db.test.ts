// Property 14 (database part): every registered service operation, called by every role and org
// combination from every channel, either succeeds for a permitted actor or is denied with the right
// code and leaves the database byte-for-byte unchanged. Cross-org ids look the same as missing ids.
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 14.4
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor, type Capability, CAPABILITY_MATRIX, type Channel, ROLES, type Role, serviceRegistry,
} from '../src/domain/permissions.js';
import { agreements, balingRequests, balingServices, conversations, drafts, lineIdentities } from '../src/repos/index.js';
import {
  createAgreementReadService, createAssessmentService, createBalingRequestService, createBalingServiceService, createConversationService,
  createDemandService, createDraftService, createJobQueue, createListingService, createMatchReadService, createMediaService,
  createOfferService, createResaleService, DbMediaStore, type DraftKind, MediaServiceError, ok, type Result,
} from '../src/services/index.js';
import { createLineIdentityService, LINK_FAILURE_MESSAGE_TH } from '../src/services/identity/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeImageBytes, makeListing, makeOffer, makeOrgWithUser } from './factories.js';

const CHANNELS: readonly Channel[] = ['web', 'line:farmer', 'line:baler', 'line:factory', 'assistant'];
const LINE_ROLE: Partial<Record<Channel, Role>> = { 'line:farmer': 'FARMER', 'line:baler': 'BALER', 'line:factory': 'BUYER_FACTORY' };
type Outcome = string; // 'OK' or a stable error code

interface Fx {
  /** Organizations that may reach the resource. 'ALL' means no resource rule (create, list). */
  related: readonly string[] | 'ALL';
  run(actor: Actor): Promise<unknown>;
}
interface Op {
  id: string;
  /** Name in the service registry. */
  service: string;
  capability: Capability;
  /** Compare `capability` with the registry entry. False for create operations that use a create capability. */
  registryCheck?: boolean;
  /** Assistant channel is refused for every actor (publish, send, accept, confirm, cancel, ...). */
  humanOnly?: boolean;
  /** Safe to reuse one fixture for allowed calls. */
  readOnly?: boolean;
  make(missing: boolean): Promise<Fx>;
  /** Side-effect counter that must not move during denied calls. */
  probe?: () => number;
}

describe.skipIf(!testDatabaseUrl)('permissions across services (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  type Party = Awaited<ReturnType<typeof makeOrgWithUser>>;
  const P = {} as Record<'farmerA' | 'balerA' | 'factoryA' | 'farmerB' | 'balerB' | 'factoryB', Party>;
  let actors: Actor[] = [];
  let tables: string[] = [];
  let acceptCalls = 0;
  let filler = 1;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    P.farmerA = await makeOrgWithUser(pool, 'FARMER');
    P.balerA = await makeOrgWithUser(pool, 'BALER');
    P.factoryA = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    P.farmerB = await makeOrgWithUser(pool, 'FARMER');
    P.balerB = await makeOrgWithUser(pool, 'BALER');
    P.factoryB = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    // Every role x org x channel, including combinations that cannot occur in production (a BALER acting
    // for a farmer organization, a farmer role on the baler LINE channel). Denial must not depend on them.
    actors = Object.values(P).flatMap((p) =>
      ROLES.flatMap((role) => CHANNELS.map((channel): Actor => ({ userId: p.user.id, orgId: p.org.id, role, channel }))),
    );
    tables = (
      await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'pgmigrations' ORDER BY tablename`,
      )
    ).rows.map((r) => r.tablename);
  });
  afterAll(async () => {
    await db?.close();
  });

  // ---- database snapshot -------------------------------------------------------------------
  const snapshotSql = (): string =>
    tables
      .map((t) => `SELECT '${t}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`)
      .join(' UNION ALL ');
  async function snapshot(): Promise<Map<string, string>> {
    const { rows } = await pool.query<{ t: string; n: number; h: string }>(snapshotSql());
    return new Map(rows.map((r) => [r.t, `${r.n}:${r.h}`]));
  }
  const changedTables = (a: Map<string, string>, b: Map<string, string>): string[] =>
    [...a].filter(([t, v]) => b.get(t) !== v).map(([t]) => t);

  // ---- outcomes and expectations -----------------------------------------------------------
  async function outcomeOf(fn: () => Promise<unknown>): Promise<Outcome> {
    try {
      const r = await fn();
      if (r !== null && typeof r === 'object' && 'ok' in r && typeof (r as { ok: unknown }).ok === 'boolean') {
        const res = r as Result<unknown>;
        return res.ok ? 'OK' : res.error.code;
      }
      return 'OK';
    } catch (e) {
      if (e instanceof MediaServiceError) return e.code;
      throw e;
    }
  }
  const rolesOf = (op: Op): readonly Role[] => CAPABILITY_MATRIX[op.capability].roles;
  const channelConsistent = (a: Actor): boolean => LINE_ROLE[a.channel] === undefined || LINE_ROLE[a.channel] === a.role;
  type Expect = { kind: 'OK' } | { kind: 'exact'; code: string } | { kind: 'hidden' };
  function expectation(op: Op, a: Actor, fx: Fx): Expect {
    if (op.humanOnly && a.channel === 'assistant') return { kind: 'exact', code: 'FORBIDDEN' };
    const roleOk = rolesOf(op).includes(a.role) && channelConsistent(a);
    const related = fx.related === 'ALL' || fx.related.includes(a.orgId);
    if (roleOk) return related ? { kind: 'OK' } : { kind: 'exact', code: 'NOT_FOUND' };
    return related ? { kind: 'exact', code: 'FORBIDDEN' } : { kind: 'hidden' };
  }
  const label = (op: Op, a: Actor): string => `${op.id} as ${a.role} of ${a.orgId.slice(0, 8)} via ${a.channel}`;

  // ---- fixtures ----------------------------------------------------------------------------
  const FULL_PATCH: Record<Exclude<DraftKind, 'RESALE_LISTING'>, Record<string, unknown>> = {
    SALE_LISTING: { material_type: 'RICE_STRAW', quantity: { value: '1000', unit: 'kg' }, price_mode: 'NEGOTIABLE', province: 'Test Province' },
    PURCHASE_DEMAND: { accepted_materials: ['RICE_STRAW'], target_quantity: { value: '5000', unit: 'kg' }, price_mode: 'NEGOTIABLE', province: 'Test Province' },
    BALING_SERVICE: { material_types: ['RICE_STRAW'], service_mode: 'ON_SITE', price_mode: 'NEGOTIABLE', province: 'Test Province' },
    BALING_REQUEST: { material_type: 'RICE_STRAW', quantity: { value: '1000', unit: 'kg' }, requested_mode: 'ON_SITE', province: 'Test Province' },
  };
  const DRAFT_OWNER: Record<DraftKind, keyof typeof P> = {
    SALE_LISTING: 'farmerA', RESALE_LISTING: 'balerA', PURCHASE_DEMAND: 'factoryA', BALING_SERVICE: 'balerA', BALING_REQUEST: 'farmerA',
  };
  const DRAFT_SERVICE: Record<DraftKind, string> = {
    SALE_LISTING: 'drafts.sale_listing', RESALE_LISTING: 'drafts.resale_listing', PURCHASE_DEMAND: 'drafts.purchase_demand',
    BALING_SERVICE: 'drafts.baling_service', BALING_REQUEST: 'drafts.baling_request',
  };
  const MANAGE: Record<DraftKind, Capability> = {
    SALE_LISTING: 'LISTING_MANAGE', RESALE_LISTING: 'LISTING_MANAGE', PURCHASE_DEMAND: 'DEMAND_MANAGE',
    BALING_SERVICE: 'BALING_SERVICE_MANAGE', BALING_REQUEST: 'BALING_REQUEST_SUBMIT',
  };
  const CREATE: Record<Exclude<DraftKind, 'RESALE_LISTING'>, Capability> = {
    SALE_LISTING: 'LISTING_CREATE', PURCHASE_DEMAND: 'DEMAND_CREATE', BALING_SERVICE: 'BALING_SERVICE_PUBLISH', BALING_REQUEST: 'BALING_REQUEST_SUBMIT',
  };
  const web = (p: Party, role: Role): Actor => ({ userId: p.user.id, orgId: p.org.id, role, channel: 'web' });
  const drafts$ = () => createDraftService({ pool });

  /** A complete draft awaiting review, owned by the natural organization of its kind. */
  async function makeDraft(kind: DraftKind): Promise<{ id: string; version: number; orgId: string }> {
    const owner = P[DRAFT_OWNER[kind]];
    if (kind === 'RESALE_LISTING') {
      // A resale draft starts from an agreement in which the baler bought from a farmer.
      const src = await makeListing(pool, P.farmerA.org.id);
      const srcDemand = await makeDemand(pool, owner.org.id);
      const offer = await makeOffer(pool, { listing: src, demand: srcDemand });
      const agreement = await agreements.insertIfAbsent(pool, {
        kind: 'PURCHASE', offer_id: offer.id, seller_org_id: P.farmerA.org.id, buyer_org_id: owner.org.id, listing_id: src.id,
        demand_id: srcDemand.id, qty_kg: '1000.000', status: 'PURCHASE_CONFIRMED',
      });
      const row = await drafts.insert(pool, {
        source_agreement_id: agreement?.id ?? null,
        org_id: owner.org.id, created_by: owner.user.id, kind, status: 'AWAITING_REVIEW',
        data: {
          material_type: 'RICE_STRAW', qty_kg: '1000.000', price_mode: 'NEGOTIABLE', province: 'Test Province', pending_material: false,
        },
      });
      // Publishing requires the reservation a real resale draft always has (task 16.3).
      if (agreement) {
        await pool.query(
          `INSERT INTO resale_allocations (source_agreement_id, draft_id, qty_kg, status) VALUES ($1, $2, 1000, 'ACTIVE')`,
          [agreement.id, row.id],
        );
        await pool.query(`UPDATE agreements SET resale_reserved_kg = 1000 WHERE id = $1`, [agreement.id]);
      }
      return { id: row.id, version: row.version, orgId: owner.org.id };
    }
    const r = await drafts$().create(web(owner, owner.org.kind as Role), { kind, patch: FULL_PATCH[kind] });
    if (!r.ok) throw new Error(`fixture draft failed: ${r.error.code}`);
    expect(r.value.draft.status).toBe('AWAITING_REVIEW');
    return { id: r.value.draft.id, version: r.value.draft.version, orgId: owner.org.id };
  }

  function draftOps(kind: DraftKind): Op[] {
    const service = DRAFT_SERVICE[kind];
    const capability = MANAGE[kind];
    const base = { service, capability };
    const missingDraft = { id: randomUUID(), version: 1, orgId: '' };
    const use = async (missing: boolean) => (missing ? missingDraft : makeDraft(kind));
    const ops: Op[] = [
      {
        ...base, id: `${service}:get`, readOnly: true,
        async make(m) { const d = await use(m); return { related: m ? [] : [d.orgId], run: (a) => drafts$().get(a, d.id) }; },
      },
      {
        ...base, id: `${service}:patch`,
        async make(m) {
          const d = await use(m);
          return { related: m ? [] : [d.orgId], run: (a) => drafts$().patch(a, { draftId: d.id, expectedVersion: d.version, patch: { province: 'Other Province' } }) };
        },
      },
      {
        ...base, id: `${service}:cancel`, humanOnly: true,
        async make(m) {
          const d = await use(m);
          return { related: m ? [] : [d.orgId], run: (a) => drafts$().cancel(a, { draftId: d.id, expectedVersion: d.version }) };
        },
      },
    ];
    ops.push({
        ...base, id: `${service}:publish`, humanOnly: true,
        async make(m) {
          const d = await use(m);
          return { related: m ? [] : [d.orgId], run: (a) => drafts$().publish(a, { draftId: d.id, expectedVersion: d.version }) };
        },
    });
    if (kind !== 'RESALE_LISTING') {
      // Resale drafts are never created directly; they start from an agreement.
      ops.push({
        service, capability: CREATE[kind], registryCheck: false, id: `${service}:create`,
        async make() { return { related: 'ALL', run: (a) => drafts$().create(a, { kind, patch: FULL_PATCH[kind] }) }; },
      });
    }
    return ops;
  }

  type LifecycleLike = {
    get(a: Actor, id: string): Promise<unknown>;
    list(a: Actor): Promise<Result<{ org_id: string }[]>>;
    pause(a: Actor, i: { id: string; expectedVersion: number }): Promise<unknown>;
    open(a: Actor, i: { id: string; expectedVersion: number }): Promise<unknown>;
    close(a: Actor, i: { id: string; expectedVersion: number }): Promise<unknown>;
    cancel(a: Actor, i: { id: string; expectedVersion: number }): Promise<unknown>;
  };
  function lifecycleOps(
    service: string, capability: Capability, owner: keyof typeof P, svc: () => LifecycleLike,
    insert: (status: 'PUBLISHED' | 'PAUSED') => Promise<{ id: string; version: number }>,
  ): Op[] {
    const orgId = () => P[owner].org.id;
    const target = async (m: boolean, status: 'PUBLISHED' | 'PAUSED' = 'PUBLISHED') =>
      m ? { id: randomUUID(), version: 1 } : insert(status);
    const transition = (name: 'pause' | 'open' | 'close' | 'cancel', status: 'PUBLISHED' | 'PAUSED'): Op => ({
      service, capability, id: `${service}:${name}`, humanOnly: true,
      async make(m) {
        const t = await target(m, status);
        return { related: m ? [] : [orgId()], run: (a) => svc()[name](a, { id: t.id, expectedVersion: t.version }) };
      },
    });
    return [
      {
        service, capability, id: `${service}:get`, readOnly: true,
        async make(m) { const t = await target(m); return { related: m ? [] : [orgId()], run: (a) => svc().get(a, t.id) }; },
      },
      {
        service, capability, id: `${service}:list`, readOnly: true,
        async make() {
          await insert('PUBLISHED');
          return {
            related: 'ALL',
            run: async (a) => {
              const r = await svc().list(a);
              // A list never carries another organization's rows.
              if (r.ok && r.value.some((x) => x.org_id !== a.orgId)) throw new Error('list leaked another organization');
              return r;
            },
          };
        },
      },
      transition('pause', 'PUBLISHED'),
      transition('open', 'PAUSED'),
      transition('close', 'PUBLISHED'),
      transition('cancel', 'PUBLISHED'),
    ];
  }

  const offers$ = () =>
    createOfferService({ pool }, {
      acceptor: async () => { acceptCalls++; return ok({ stub: true }); },
    });
  async function makeOfferFixture() {
    const listing = await makeListing(pool, P.farmerA.org.id);
    const demand = await makeDemand(pool, P.factoryA.org.id);
    const offer = await makeOffer(pool, { listing, demand });
    return { listing, demand, offer };
  }
  const offerOps = (): Op[] => {
    const byOffer = (
      id: string, service: string, capability: Capability, who: (o: { from: string; to: string }) => string[],
      call: (svc: ReturnType<typeof offers$>, a: Actor, o: { id: string; version: number }) => Promise<unknown>,
      extra: Partial<Op> = {},
    ): Op => ({
      id, service, capability, ...extra,
      async make(m) {
        if (m) return { related: [], run: (a) => call(offers$(), a, { id: randomUUID(), version: 1 }) };
        const f = await makeOfferFixture();
        return {
          related: who({ from: f.offer.from_org_id, to: f.offer.to_org_id }),
          run: (a) => call(offers$(), a, { id: f.offer.id, version: f.offer.version }),
        };
      },
    });
    return [
      {
        id: 'offers.send:create', service: 'offers.send', capability: 'OFFER_SEND', humanOnly: true,
        async make(m) {
          const f = m ? null : await makeOfferFixture();
          const listingId = f?.listing.id ?? randomUUID();
          const demandId = f?.demand.id ?? randomUUID();
          return {
            related: f ? [f.listing.org_id, f.demand.org_id] : [],
            run: (a) => offers$().create(a, { kind: 'PURCHASE', listingId, demandId, qtyKg: '1000', unitPriceThb: '1.5', priceUnit: 'KG' }),
          };
        },
      },
      byOffer('offers.read:get', 'offers.read', 'OFFER_READ', (o) => [o.from, o.to], (s, a, o) => s.get(a, o.id), { readOnly: true }),
      {
        id: 'offers.read:list', service: 'offers.read', capability: 'OFFER_READ', readOnly: true,
        async make() {
          await makeOfferFixture();
          return {
            related: 'ALL',
            run: async (a) => {
              const r = await offers$().list(a);
              if (r.ok && r.value.some((o) => o.from_org_id !== a.orgId && o.to_org_id !== a.orgId)) throw new Error('list leaked another organization');
              return r;
            },
          };
        },
      },
      byOffer('offers.respond:reject', 'offers.respond', 'OFFER_RESPOND', (o) => [o.to],
        (s, a, o) => s.reject(a, { offerId: o.id, expectedVersion: o.version }), { humanOnly: true }),
      byOffer('offers.respond:accept', 'offers.respond', 'OFFER_RESPOND', (o) => [o.to],
        (s, a, o) => s.accept(a, { offerId: o.id }), { humanOnly: true, probe: () => acceptCalls }),
      byOffer('offers.withdraw:withdraw', 'offers.withdraw', 'OFFER_WITHDRAW', (o) => [o.from],
        (s, a, o) => s.withdraw(a, { offerId: o.id, expectedVersion: o.version }), { humanOnly: true }),
      byOffer('offers.edit:edit', 'offers.edit', 'OFFER_WITHDRAW', (o) => [o.from],
        (s, a, o) => s.edit(a, { offerId: o.id, expectedVersion: o.version, changes: { qtyKg: '500' } }), { humanOnly: true }),
    ];
  };

  const SECRET = 'permissions-test-secret-0123456789abcdef';
  const agreementOps = (): Op[] => {
    const make = (list: boolean) => async (): Promise<Fx> => {
      const f = await makeOfferFixture();
      const a = await agreements.insert(pool, {
        kind: 'PURCHASE', offer_id: f.offer.id, seller_org_id: f.listing.org_id, buyer_org_id: f.demand.org_id,
        listing_id: f.listing.id, demand_id: f.demand.id, qty_kg: '1000.000', status: 'PURCHASE_CONFIRMED',
      });
      const svc = createAgreementReadService({ pool });
      return list
        ? { related: 'ALL', run: async (act) => {
            const r = await svc.list(act);
            if (r.ok && r.value.some((x) => x.seller_org_id !== act.orgId && x.buyer_org_id !== act.orgId)) throw new Error('list leaked another organization');
            return r;
          } }
        : { related: [a.seller_org_id, a.buyer_org_id], run: (act) => svc.get(act, a.id) };
    };
    return [
      { id: 'agreements:get', service: 'agreements', capability: 'OFFER_READ', readOnly: true, async make(missing) {
        if (missing) { const svc = createAgreementReadService({ pool }); return { related: [], run: (act) => svc.get(act, randomUUID()) }; }
        return make(false)();
      } },
      { id: 'agreements:list', service: 'agreements', capability: 'OFFER_READ', readOnly: true, make: make(true) },
    ];
  };
  // Resale draft creation: only a BALER of the agreement's buyer organization (Requirement 14.4).
  const resaleOps = (): Op[] => [
    { id: 'resale:create-draft', service: 'resale', capability: 'RESALE_DRAFT_CREATE', async make(missing) {
      const svc = createResaleService({ pool });
      if (missing) return { related: [], run: (act) => svc.createDraft(act, { agreementId: randomUUID() }) };
      const listing = await makeListing(pool, P.farmerA.org.id);
      const demand = await makeDemand(pool, P.balerA.org.id);
      const offer = await makeOffer(pool, { listing, demand });
      const a = await agreements.insert(pool, {
        kind: 'PURCHASE', offer_id: offer.id, seller_org_id: listing.org_id, buyer_org_id: demand.org_id,
        listing_id: listing.id, demand_id: demand.id, qty_kg: '1000.000', status: 'PURCHASE_CONFIRMED',
      });
      return { related: [a.buyer_org_id], run: (act) => svc.createDraft(act, { agreementId: a.id }) };
    } },
  ];
  const media$ = () => createMediaService({ pool, secret: SECRET, ttlSeconds: 60 });
  const assess$ = () => createAssessmentService({ pool, queue: createJobQueue(pool), secret: SECRET, ttlSeconds: 60 });
  async function makeMedia() {
    const listing = await makeListing(pool, P.farmerA.org.id);
    const { meta } = await new DbMediaStore(pool).put({
      orgId: P.farmerA.org.id, ownerType: 'LISTING', ownerId: listing.id, createdBy: P.farmerA.user.id, bytes: makeImageBytes('jpeg', filler++),
    });
    return meta;
  }
  const mediaOps = (): Op[] => {
    const byMedia = (name: string, service: string, call: (a: Actor, mediaId: string) => Promise<unknown>, readOnly: boolean): Op => ({
      id: `${service}:${name}`, service, capability: 'LISTING_MANAGE', readOnly,
      async make(m) {
        const meta = m ? null : await makeMedia();
        return { related: meta ? [meta.orgId] : [], run: (a) => call(a, meta?.id ?? randomUUID()) };
      },
    });
    const upload = (name: string, service: string, owner: 'DRAFT' | 'LISTING', svc: () => { upload(a: Actor, i: { ownerType: 'DRAFT' | 'LISTING'; ownerId: string; bytes: Uint8Array }): Promise<unknown> }): Op => ({
      id: `${service}:${name}`, service, capability: 'LISTING_MANAGE',
      async make(m) {
        let ownerId: string = randomUUID();
        let related: string[] = [];
        if (!m) {
          related = [P.farmerA.org.id];
          ownerId = owner === 'DRAFT' ? (await makeDraft('SALE_LISTING')).id : (await makeListing(pool, P.farmerA.org.id)).id;
        }
        return { related, run: (a) => svc().upload(a, { ownerType: owner, ownerId, bytes: makeImageBytes('png', filler++) }) };
      },
    });
    return [
      upload('upload-draft', 'media', 'DRAFT', media$),
      upload('upload-listing', 'media', 'LISTING', media$),
      byMedia('url', 'media', (a, id) => media$().getMediaUrl(a, id), true),
      byMedia('content', 'media', (a, id) => media$().getContent(a, id), true),
      byMedia('delete', 'media', (a, id) => media$().delete(a, id), false),
      upload('upload-draft', 'assessment', 'DRAFT', assess$),
      upload('upload-listing', 'assessment', 'LISTING', assess$),
      byMedia('get', 'assessment', (a, id) => assess$().get(a, id), true),
    ];
  };

  const convs$ = () => createConversationService({ pool });
  const conversationOps = (): Op[] => {
    const owned = (name: string, call: (a: Actor, id: string) => Promise<unknown>, readOnly = true): Op => ({
      id: `conversations:${name}`, service: 'conversations', capability: 'CHAT_ASSISTANT', readOnly,
      async make(m) {
        const row = m ? null : await conversations.insert(pool, { channel: 'web', user_id: P.farmerA.user.id, org_id: P.farmerA.org.id });
        return { related: row?.org_id ? [row.org_id] : [], run: (a) => call(a, row?.id ?? randomUUID()) };
      },
    });
    return [
      {
        id: 'conversations:open', service: 'conversations', capability: 'CHAT_ASSISTANT', readOnly: true,
        async make() { return { related: 'ALL', run: (a) => convs$().open(a) }; },
      },
      owned('get', (a, id) => convs$().get(a, id)),
      owned('recent', (a, id) => convs$().recent(a, id, 10)),
      owned('append', (a, id) => convs$().append(a, { conversationId: id, direction: 'IN', text: 'hello' }), false),
      owned('setActiveDraft', (a, id) => convs$().setActiveDraft(a, id, null), false),
    ];
  };

  const matchOps = (): Op[] => [
    {
      id: 'matches:list', service: 'matches', capability: 'PUBLISHED_VIEW_READ', readOnly: true,
      async make() { return { related: 'ALL', run: (a) => createMatchReadService({ pool }).list(a) }; },
    },
  ];
  function allOps(): Op[] {
    const kinds: DraftKind[] = ['SALE_LISTING', 'RESALE_LISTING', 'PURCHASE_DEMAND', 'BALING_SERVICE', 'BALING_REQUEST'];
    return [
      ...kinds.flatMap(draftOps),
      ...lifecycleOps('listings', 'LISTING_MANAGE', 'farmerA', () => createListingService({ pool }), (status) => makeListing(pool, P.farmerA.org.id, { status })),
      ...lifecycleOps('demands', 'DEMAND_MANAGE', 'factoryA', () => createDemandService({ pool }), (status) => makeDemand(pool, P.factoryA.org.id, { status })),
      ...lifecycleOps('baling_services', 'BALING_SERVICE_MANAGE', 'balerA', () => createBalingServiceService({ pool }), (status) =>
        balingServices.insert(pool, {
          org_id: P.balerA.org.id, material_types: ['RICE_STRAW'], service_mode: 'ON_SITE', price_mode: 'FIXED', unit_price_thb: '0.8000', price_unit: 'KG', status,
        })),
      ...lifecycleOps('baling_requests', 'BALING_REQUEST_SUBMIT', 'farmerA', () => createBalingRequestService({ pool }), (status) =>
        balingRequests.insert(pool, { org_id: P.farmerA.org.id, material_type: 'RICE_STRAW', qty_kg: '3000.000', requested_mode: 'ON_SITE', status })),
      ...offerOps(),
      ...agreementOps(),
      ...resaleOps(),
      ...mediaOps(),
      ...conversationOps(),
      ...matchOps(),
    ];
  }

  // ---- the matrix ---------------------------------------------------------------------------
  it('declares a capability for every registered service and covers each one with an operation', () => {
    expect(serviceRegistry.undeclared()).toEqual([]);
    const ops = allOps();
    const covered = new Set(ops.map((o) => o.service));
    const registered = [...serviceRegistry.entries().keys()];
    expect(registered.filter((s) => !covered.has(s)), 'registered services without a permission test').toEqual([]);
    for (const op of ops.filter((o) => o.registryCheck !== false)) {
      expect(serviceRegistry.entries().get(op.service), op.id).toBe(op.capability);
    }
  });

  const opIds = (() => {
    // Operation ids are known without a database, so each operation gets its own test case.
    const names: string[] = [];
    const kinds = ['sale_listing', 'resale_listing', 'purchase_demand', 'baling_service', 'baling_request'];
    for (const k of kinds) {
      const ops = ['get', 'patch', 'cancel', 'publish', ...(k === 'resale_listing' ? [] : ['create'])];
      for (const o of ops) names.push(`drafts.${k}:${o}`);
    }
    for (const s of ['listings', 'demands', 'baling_services', 'baling_requests']) {
      for (const o of ['get', 'list', 'pause', 'open', 'close', 'cancel']) names.push(`${s}:${o}`);
    }
    names.push(
      'offers.send:create', 'offers.read:get', 'offers.read:list', 'offers.respond:reject', 'offers.respond:accept',
      'offers.withdraw:withdraw', 'offers.edit:edit', 'agreements:get', 'agreements:list', 'resale:create-draft',
      'media:upload-draft', 'media:upload-listing', 'media:url', 'media:content', 'media:delete',
      'assessment:upload-draft', 'assessment:upload-listing', 'assessment:get',
      'conversations:open', 'conversations:get', 'conversations:recent', 'conversations:append', 'conversations:setActiveDraft',
      'matches:list',
    );
    return names;
  })();

  it('has one test case per operation', () => {
    expect(allOps().map((o) => o.id).sort()).toEqual([...opIds].sort());
  });

  describe.each(opIds)('%s', (id) => {
    it('permits exactly the allowed actors and leaves the database unchanged for every denied call', { timeout: 180_000 }, async () => {
      const op = allOps().find((o) => o.id === id);
      if (!op) throw new Error(`unknown operation ${id}`);
      const shared = await op.make(false);
      const missing = shared.related === 'ALL' ? shared : await op.make(true);
      const allowed: Actor[] = [];
      let denied = 0;
      for (const actor of actors) {
        const exp = expectation(op, actor, shared);
        if (exp.kind === 'OK') {
          allowed.push(actor);
          continue;
        }
        const probeBefore = op.probe?.();
        const before = await snapshot();
        const got = await outcomeOf(() => shared.run(actor));
        const same = await outcomeOf(() => missing.run(actor)); // the same call with an id that does not exist
        const after = await snapshot();
        const where = label(op, actor);
        expect(changedTables(before, after), `${where}: tables changed by a denied call`).toEqual([]);
        if (op.probe) expect(op.probe(), `${where}: side effect ran`).toBe(probeBefore);
        if (exp.kind === 'exact') expect(got, where).toBe(exp.code);
        else expect(['FORBIDDEN', 'NOT_FOUND'], where).toContain(got);
        // A cross-org id is indistinguishable from a missing one.
        if (shared.related !== 'ALL' && !shared.related.includes(actor.orgId)) expect(got, `${where}: differs from a missing id`).toBe(same);
        denied++;
      }
      expect(denied).toBeGreaterThan(0);
      expect(allowed.length).toBeGreaterThan(0);
      for (const actor of allowed) {
        const fx = op.readOnly ? shared : await op.make(false);
        expect(await outcomeOf(() => fx.run(actor)), label(op, actor)).toBe('OK');
      }
    });
  });

  it('drafts.list returns only the actor organization and only kinds the role may manage', async () => {
    for (const k of ['SALE_LISTING', 'PURCHASE_DEMAND', 'BALING_SERVICE', 'BALING_REQUEST'] as const) await makeDraft(k);
    for (const actor of actors) {
      const r = await drafts$().list(actor);
      expect(r.ok, label({ id: 'drafts:list' } as Op, actor)).toBe(true);
      if (!r.ok) continue;
      for (const v of r.value) {
        expect(v.draft.org_id).toBe(actor.orgId);
        const cap = MANAGE[v.draft.kind];
        expect(CAPABILITY_MATRIX[cap].roles as readonly Role[]).toContain(actor.role);
      }
    }
  });

  it('the assistant channel cannot publish, send, accept, confirm or cancel even for its own organization', async () => {
    const own = actors.filter((a) => a.channel === 'assistant');
    const d = await makeDraft('SALE_LISTING');
    const f = await makeOfferFixture();
    const before = await snapshot();
    const outcomes: Outcome[] = [];
    for (const a of own) {
      outcomes.push(
        await outcomeOf(() => drafts$().publish(a, { draftId: d.id, expectedVersion: d.version })),
        await outcomeOf(() => drafts$().cancel(a, { draftId: d.id, expectedVersion: d.version })),
        await outcomeOf(() => offers$().create(a, { kind: 'PURCHASE', listingId: f.listing.id, demandId: f.demand.id, qtyKg: '100' })),
        await outcomeOf(() => offers$().accept(a, { offerId: f.offer.id })),
        await outcomeOf(() => offers$().reject(a, { offerId: f.offer.id })),
        await outcomeOf(() => offers$().withdraw(a, { offerId: f.offer.id })),
        await outcomeOf(() => createListingService({ pool }).cancel(a, { id: f.listing.id, expectedVersion: 1 })),
      );
    }
    expect(new Set(outcomes)).toEqual(new Set(['FORBIDDEN']));
    expect(changedTables(before, await snapshot())).toEqual([]);
  });

  // ---- identity -----------------------------------------------------------------------------
  describe('identity service', () => {
    const identity = () => createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
    const FAIL = { ok: false, error: { code: 'LINK_CODE_INVALID', message_th: LINK_FAILURE_MESSAGE_TH } };

    it('issues link codes only to web members whose role matches the stored organization kind', async () => {
      let issued = 0;
      for (const actor of actors) {
        const party = Object.values(P).find((p) => p.org.id === actor.orgId) as Party;
        const legit = actor.channel === 'web' && party.org.kind === actor.role;
        const before = await snapshot();
        const r = await identity().issueLinkCode(actor);
        if (legit) {
          expect(r.ok, label({ id: 'identity:issue' } as Op, actor)).toBe(true);
          issued++;
        } else {
          expect(r, label({ id: 'identity:issue' } as Op, actor)).toEqual(FAIL);
          expect(changedTables(before, await snapshot())).toEqual([]);
        }
      }
      expect(issued).toBe(Object.keys(P).length);
      // A user who is not a member of the organization gets the same failure and no row.
      const before = await snapshot();
      expect(await identity().issueLinkCode({ ...web(P.farmerA, 'FARMER'), userId: P.farmerB.user.id })).toEqual(FAIL);
      expect(changedTables(before, await snapshot())).toEqual([]);
    });

    it('answers every refused redemption identically and leaves the code unused', async () => {
      const issuedCode = await identity().issueLinkCode(web(P.balerA, 'BALER'));
      if (!issuedCode.ok) throw new Error('fixture code');
      const { code } = issuedCode.value;
      const before = await snapshot();
      const wrongChannel = await identity().redeemLinkCode({ channel: 'factory', lineUserId: 'U-perm-1', code });
      const farmerChannel = await identity().redeemLinkCode({ channel: 'farmer', lineUserId: 'U-perm-2', code });
      const unknown = await identity().redeemLinkCode({ channel: 'baler', lineUserId: 'U-perm-3', code: 'ZZZZ2222' });
      expect([wrongChannel, farmerChannel, unknown]).toEqual([FAIL, FAIL, FAIL]);
      expect(changedTables(before, await snapshot())).toEqual([]);
      // The refused attempts did not burn the code: the right channel still redeems it.
      const good = await identity().redeemLinkCode({ channel: 'baler', lineUserId: 'U-perm-4', code });
      expect(good.ok).toBe(true);
    });

    it('gives no organization rights to unlinked identities and hides link status from non-web channels', async () => {
      const before = await snapshot();
      for (const channel of ['baler', 'factory'] as const) {
        const f = await identity().handleFollow({ channel, lineUserId: `U-follow-${channel}` });
        expect(f.actor).toBeNull();
        expect(f.createdOrganization).toBe(false);
        expect(await identity().resolveLineActor(channel, `U-follow-${channel}`)).toBeNull();
        expect(await identity().resolveLineActor(channel, 'U-unknown')).toBeNull();
      }
      const after = await snapshot();
      // Only line_identities (and the audit-free follow bookkeeping) may change; no org, user or membership rows.
      expect(changedTables(before, after).filter((t) => ['organizations', 'users', 'memberships'].includes(t))).toEqual([]);
      for (const actor of actors.filter((a) => a.channel !== 'web')) {
        expect(await identity().lineLinkStatus(actor)).toEqual([]);
      }
      const ensured = await lineIdentities.ensure(pool, 'farmer', 'U-perm-unlinked');
      expect(ensured.status).toBe('UNLINKED');
      expect(await identity().resolveLineActor('farmer', 'U-perm-unlinked')).toBeNull();
    });
  });
});
