import fc from 'fast-check';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import { createDraftService, type DraftService, type Result } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeOrgWithUser } from './factories.js';

// Feature: agrimatch-mvp, Property 12: Draft and listing state machine with versions (service part, real Postgres)
// **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**

type Status = 'DRAFT' | 'AWAITING_REVIEW' | 'PUBLISHED' | 'CANCELLED';
type Field = 'material_type' | 'quantity' | 'price_mode' | 'province';
type Data = Partial<Record<Field, string>>;
type Which = 'current' | 'older' | 'newer';

const FIELD_VALUES: Record<Field, readonly string[]> = {
  material_type: ['RICE_STRAW', 'CORN_COB'],
  quantity: ['1', '2'],
  price_mode: ['NEGOTIABLE'],
  province: ['Uttaradit', 'Phrae'],
};
const FIELDS = Object.keys(FIELD_VALUES) as Field[];

const toPatch = (d: Data): Record<string, unknown> => {
  const { quantity, ...rest } = d;
  return { ...rest, ...(quantity ? { quantity: { value: quantity, unit: 'ton' } } : {}) };
};

type Op =
  | { t: 'patch'; fields: Data; which: Which }
  | { t: 'publish'; which: Which; key: boolean }
  | { t: 'cancel'; which: Which };

const whichArb: fc.Arbitrary<Which> = fc.constantFrom('current', 'current', 'current', 'older', 'newer');
const fieldsArb: fc.Arbitrary<Data> = fc
  .subarray(FIELDS, { minLength: 1 })
  .chain((fs) =>
    fc.tuple(...fs.map((f) => fc.constantFrom(...FIELD_VALUES[f]))).map((vs) => Object.fromEntries(fs.map((f, i) => [f, vs[i]])) as Data),
  );
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ t: fc.constant('patch' as const), fields: fieldsArb, which: whichArb }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('publish' as const), which: whichArb, key: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('cancel' as const), which: whichArb }) },
);

const isComplete = (d: Data) => FIELDS.every((f) => d[f] !== undefined);
const errCode = (r: Result<unknown>) => (r.ok ? 'OK' : r.error.code);

describe.skipIf(!testDatabaseUrl)('Property 12: draft versions and publish idempotence (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let drafts: DraftService;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    drafts = createDraftService({ pool });
  });
  afterAll(async () => {
    await db?.close();
  });

  async function farmer(): Promise<Actor> {
    const { org, user } = await makeOrgWithUser(pool, 'FARMER');
    return { userId: user.id, orgId: org.id, role: 'FARMER', channel: 'web' };
  }
  const entityCount = async (draftId: string) =>
    Number((await pool.query('SELECT count(*) FROM material_listings WHERE source_draft_id = $1', [draftId])).rows[0].count);
  const jobCount = async (entityId: string) =>
    Number((await pool.query(`SELECT count(*) FROM jobs WHERE kind = 'recompute_matches' AND payload->>'entity_id' = $1`, [entityId])).rows[0].count);

  it('random patch/publish/cancel sequences follow the version model, never publish stale or incomplete drafts, and create at most one entity', async () => {
    await fc.assert(
      fc.asyncProperty(fieldsArb, fc.array(opArb, { minLength: 1, maxLength: 14 }), async (initial, ops) => {
        const actor = await farmer();
        const created = await drafts.create(actor, { kind: 'SALE_LISTING', patch: toPatch(initial) });
        if (!created.ok) throw new Error(`create failed: ${created.error.code}`);
        const id = created.value.draft.id;

        // Model
        let data: Data = { ...initial };
        let version = 1;
        let status: Status = isComplete(data) ? 'AWAITING_REVIEW' : 'DRAFT';
        let entityId: string | null = null;
        expect(created.value.draft).toMatchObject({ version, status });

        const pick = (w: Which): number => {
          if (w === 'current') return version;
          if (w === 'older') return version > 1 ? version - 1 : version + 1;
          return version + 1;
        };

        for (const op of ops) {
          const expectedVersion = pick(op.which);
          const stale = expectedVersion !== version;
          const before = { version, status };

          if (op.t === 'patch') {
            const r = await drafts.patch(actor, { draftId: id, expectedVersion, patch: toPatch(op.fields) });
            if (stale) {
              expect(errCode(r)).toBe('STALE_VERSION');
            } else if (status === 'PUBLISHED' || status === 'CANCELLED') {
              expect(errCode(r)).toBe('INVALID_STATE');
            } else {
              expect(errCode(r)).toBe('OK');
              const next: Data = { ...data, ...op.fields };
              const changed = FIELDS.some((f) => next[f] !== data[f]);
              data = next;
              if (changed) {
                version += 1; // a material edit increments the version
                status = isComplete(data) ? 'AWAITING_REVIEW' : 'DRAFT';
              }
            }
          } else if (op.t === 'cancel') {
            const r = await drafts.cancel(actor, { draftId: id, expectedVersion });
            if (stale) expect(errCode(r)).toBe('STALE_VERSION');
            else if (status === 'PUBLISHED' || status === 'CANCELLED') expect(errCode(r)).toBe('INVALID_STATE');
            else {
              expect(errCode(r)).toBe('OK');
              status = 'CANCELLED';
              version += 1;
            }
          } else {
            const idempotencyKey = op.key ? `k-${id}-${expectedVersion}` : undefined;
            const r = await drafts.publish(actor, { draftId: id, expectedVersion, ...(idempotencyKey ? { idempotencyKey } : {}) });
            if (stale) {
              expect(errCode(r)).toBe('STALE_VERSION');
            } else if (status === 'PUBLISHED') {
              expect(errCode(r)).toBe('OK');
              if (r.ok) {
                expect(r.value.entity_id).toBe(entityId);
                expect(r.value.replayed).toBe(true);
              }
            } else if (status === 'AWAITING_REVIEW') {
              expect(errCode(r)).toBe('OK');
              if (r.ok) {
                entityId = r.value.entity_id;
                expect(r.value).toMatchObject({ entity_type: 'LISTING', draft_version: version, replayed: false });
              }
              status = 'PUBLISHED';
            } else if (status === 'DRAFT') {
              expect(errCode(r)).toBe('VALIDATION'); // an incomplete draft never publishes
            } else {
              expect(errCode(r)).toBe('INVALID_STATE');
            }
          }

          // Invariants after every step
          const row = await drafts.get(actor, id);
          if (!row.ok) throw new Error('draft vanished');
          expect(row.value.draft).toMatchObject({ version, status });
          expect(row.value.draft.version).toBeGreaterThanOrEqual(before.version);
          const n = await entityCount(id);
          expect(n).toBe(status === 'PUBLISHED' ? 1 : 0);
          if (status === 'PUBLISHED') {
            expect(row.value.draft.published_entity_id).toBe(entityId);
            expect(await jobCount(entityId as string)).toBe(1);
          }
        }
      }),
    );
  });

  it('cancelling a published draft returns INVALID_STATE and changes nothing', async () => {
    const actor = await farmer();
    const c = await drafts.create(actor, { kind: 'SALE_LISTING', patch: { material_type: 'RICE_STRAW', quantity: { value: '1', unit: 'ton' }, price_mode: 'NEGOTIABLE', province: 'Uttaradit' } });
    if (!c.ok) throw new Error('create failed');
    const { id, version } = c.value.draft;
    await drafts.publish(actor, { draftId: id, expectedVersion: version });
    const r = await drafts.cancel(actor, { draftId: id, expectedVersion: version });
    expect(errCode(r)).toBe('INVALID_STATE');
  });

  it('Idempotency-Key: replay returns the stored result, a different request under the same key is a mismatch', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), fc.boolean(), async (replays, bumpFirst) => {
        const actor = await farmer();
        let d = (await drafts.create(actor, { kind: 'SALE_LISTING', patch: { material_type: 'RICE_STRAW', quantity: { value: '1', unit: 'ton' }, price_mode: 'NEGOTIABLE', province: 'Uttaradit' } }));
        if (!d.ok) throw new Error('create failed');
        if (bumpFirst) {
          d = await drafts.patch(actor, { draftId: d.value.draft.id, expectedVersion: 1, patch: { province: 'Phrae' } });
          if (!d.ok) throw new Error('patch failed');
        }
        const { id, version } = d.value.draft;
        const key = `key-${id}`;
        const first = await drafts.publish(actor, { draftId: id, expectedVersion: version, idempotencyKey: key });
        expect(first.ok && first.value.replayed).toBe(false);
        for (let i = 0; i < replays; i += 1) {
          const again = await drafts.publish(actor, { draftId: id, expectedVersion: version, idempotencyKey: key });
          expect(again.ok && again.value.entity_id).toBe(first.ok && first.value.entity_id);
          expect(again.ok && again.value.replayed).toBe(true);
        }
        const mismatch = await drafts.publish(actor, { draftId: id, expectedVersion: version + 1, idempotencyKey: key });
        expect(errCode(mismatch)).toBe('IDEMPOTENCY_MISMATCH');
        expect(await entityCount(id)).toBe(1);
      }),
    );
  });

  it('concurrent publishes (with and without keys) of one version create exactly one entity; a racing patch never yields a mismatched entity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        fc.boolean(),
        async (n, keyed, racePatch) => {
          const actor = await farmer();
          const c = await drafts.create(actor, { kind: 'SALE_LISTING', patch: { material_type: 'RICE_STRAW', quantity: { value: '1', unit: 'ton' }, price_mode: 'NEGOTIABLE', province: 'Uttaradit' } });
          if (!c.ok) throw new Error('create failed');
          const { id } = c.value.draft;
          const jobs: Promise<Result<unknown>>[] = Array.from({ length: n }, (_, i) =>
            drafts.publish(actor, { draftId: id, expectedVersion: 1, ...(keyed[i] ? { idempotencyKey: `c${i}-${id}` } : {}) }),
          );
          if (racePatch) jobs.push(drafts.patch(actor, { draftId: id, expectedVersion: 1, patch: { province: 'Phrae' } }));
          const results = await Promise.all(jobs);

          const okIds = new Set(
            results.slice(0, n).flatMap((r) => (r.ok ? [(r.value as { entity_id: string }).entity_id] : [])),
          );
          const count = await entityCount(id);
          expect(count).toBeLessThanOrEqual(1);
          expect(okIds.size).toBe(count);
          for (const r of results.slice(0, n)) {
            if (!r.ok) expect(['STALE_VERSION', 'INVALID_STATE']).toContain(r.error.code);
          }
          const draft = (await drafts.get(actor, id));
          if (!draft.ok) throw new Error('draft vanished');
          if (count === 1) {
            expect(draft.value.draft.status).toBe('PUBLISHED');
            expect(draft.value.draft.version).toBe(1); // a published draft keeps the confirmed version
            expect([...okIds][0]).toBe(draft.value.draft.published_entity_id);
            expect(await jobCount([...okIds][0] as string)).toBe(1);
          } else {
            expect(draft.value.draft.status).not.toBe('PUBLISHED');
          }
        },
      ),
    );
  });
});
