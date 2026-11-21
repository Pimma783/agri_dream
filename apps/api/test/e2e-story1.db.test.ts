// Story 1 end to end (task 14.2): a farmer sells straw directly to a plant. Real Postgres, real app, real services.
// Farmer: LINE only, through signed webhook requests, the line_event job and the farmer handler (FakeLineClient, MockBedrock).
// Factory: the Dashboard over HTTP with session cookie and CSRF. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_TABLE } from '../src/services/errors.js';
import { allText, createE2e, type E2e, type FarmerLine, type Json, type Session, turn } from './e2e-harness.js';
import { testDatabaseUrl } from './db-helper.js';

const CONFIRM = 'ยืนยันเผยแพร่';
const ACCEPT = 'ตอบรับ';
const REJECT = 'ปฏิเสธ';

describe.skipIf(!testDatabaseUrl)('story 1: direct sale, farmer in LINE, factory on the Dashboard', () => {
  let e: E2e;
  let n = 0;
  beforeAll(async () => { e = await createE2e(); });
  afterAll(async () => { await e?.close(); });

  const uid = () => `U-synthetic-e2e-farmer-${++n}-${Date.now()}`;
  const sql = (q: string, p: unknown[] = []) => e.db.pool.query(q, p).then((r) => r.rows);

  interface Seller { line: FarmerLine; orgId: string; userId: string; listingId: string }

  /** A farmer follows, chats with the (mock) assistant, optionally shares a location, and publishes with the button. */
  async function farmerSells(o: { location?: { lat: number; lng: number }; qtyTon?: string; price?: string } = {}): Promise<Seller> {
    const line = e.farmer(uid());
    await line.follow();
    e.script(turn('SALE_LISTING', { material_type: 'RICE_STRAW', material_form: 'LOOSE', quantity: { value: o.qtyTon ?? '10', unit: 'ton' } }));
    const first = await line.text(`ขายฟางข้าว ${o.qtyTon ?? '10'} ตัน`);
    expect(first.some((m) => m.quickReply?.items.some((i: { action: { label: string } }) => i.action.label === CONFIRM))).toBe(false); // incomplete: no confirm yet
    if (o.location) await line.location(o.location.lat, o.location.lng);
    e.script(turn('SALE_LISTING', { price_mode: 'FIXED', price: { value: o.price ?? '1.2', unit: 'kg' }, province: 'Uttaradit' }));
    const preview = await line.text('ราคา 1.2 บาทต่อกิโล จังหวัดอุตรดิตถ์');
    const confirm = line.button(preview, CONFIRM);
    await line.postback(confirm);
    const org = await line.org();
    const [row] = await sql(`SELECT id FROM material_listings WHERE org_id = $1`, [org.org_id]);
    await e.runJobs(); // recompute_matches for the new listing
    return { line, orgId: org.org_id, userId: org.user_id, listingId: row.id as string };
  }

  /** A factory publishes a demand on the Dashboard; the recompute job runs. */
  async function factoryBuys(o: { name?: string; maxPrice?: string; lat?: string; lng?: string } = {}): Promise<{ s: Session; demandId: string }> {
    const s = await e.loginAs('BUYER_FACTORY', o.name ?? `synthetic-plant-${++n}`);
    const patch = {
      accepted_materials: ['RICE_STRAW'], accepted_forms: ['LOOSE', 'BALED'], target_quantity: { value: '50', unit: 'ton' },
      price_mode: 'FIXED', price: { value: o.maxPrice ?? '1.5', unit: 'kg' }, province: 'Uttaradit',
      lat: o.lat ?? '17.7', lng: o.lng ?? '100.2', radius_km: '60', transport_by: 'EITHER',
    };
    const d = await e.call(s, 'POST', '/drafts', { kind: 'PURCHASE_DEMAND', patch });
    expect(d.status).toBe(201);
    const p = await e.call(s, 'POST', `/drafts/${d.body.draft.id}/publish`, { expectedVersion: d.body.draft.version });
    expect(p.status).toBe(200);
    await e.runJobs();
    return { s, demandId: p.body.entity_id as string };
  }

  const matchFor = async (s: Session, listingId: string) => {
    const r = await e.call(s, 'GET', '/matches?route=1');
    expect(r.status).toBe(200);
    return (r.body as Array<{ id: string; counterparty: { entity_id: string } }>).find((m) => m.counterparty.entity_id === listingId);
  };
  const offerFrom = (s: Session, matchId: string, qtyKg: string, price = '1.2'): Promise<Json> =>
    e.call(s, 'POST', '/offers', { kind: 'PURCHASE', matchId, qtyKg, unitPriceThb: price, priceUnit: 'KG', transportBy: 'BUYER' });
  /** The accept or reject button LINE delivered for one offer. */
  const buttonFor = (line: FarmerLine, offerId: string, label: string): string => {
    for (const m of line.inbox()) {
      for (const i of m.quickReply?.items ?? []) if (i.action.label === label && String(i.action.data).includes(`id=${offerId}&`)) return i.action.data as string;
    }
    throw new Error(`no "${label}" button for offer ${offerId}`);
  };
  const listingRow = async (id: string) => (await sql(`SELECT status, total_qty_kg::text AS total, committed_qty_kg::text AS committed, remaining_qty_kg::text AS remaining FROM material_listings WHERE id = $1`, [id]))[0];

  it('chat creates a draft, a location is saved, a stale button is refused, and the confirm button publishes exactly once', async () => {
    const line = e.farmer(uid());
    await line.follow();
    expect(line.inbox().at(-1)?.text).toContain('AgriMatch');

    e.script(turn('SALE_LISTING', { material_type: 'RICE_STRAW', material_form: 'LOOSE', quantity: { value: '10', unit: 'ton' } }));
    await line.text('ขายฟางข้าว 10 ตัน');
    const org = await line.org();
    const [draft] = await sql(`SELECT id, version, status, data FROM drafts WHERE org_id = $1`, [org.org_id]);
    expect(draft).toMatchObject({ status: 'DRAFT', data: { material_type: 'RICE_STRAW', qty_kg: '10000.000' } });
    expect(await e.count(`SELECT count(*) AS n FROM material_listings WHERE org_id = $1`, [org.org_id])).toBe(0); // the assistant never publishes

    const located = await line.location(17.62, 100.1);
    expect(located[0]!.text).toContain('ระยะทางเส้นตรง');
    e.script(turn('SALE_LISTING', { price_mode: 'FIXED', price: { value: '1.2', unit: 'kg' }, province: 'Uttaradit' }));
    const preview = await line.text('ราคา 1.2 บาทต่อกิโล จังหวัดอุตรดิตถ์');
    expect(preview[0]!.quickReply.items.map((i: { action: { label: string } }) => i.action.label)).toEqual([CONFIRM, 'แก้ไข', 'เก็บร่าง']);
    const [ready] = await sql(`SELECT id, version, status, data FROM drafts WHERE org_id = $1`, [org.org_id]);
    expect(ready).toMatchObject({ status: 'AWAITING_REVIEW', data: { lat: '17.620000', lng: '100.100000', unit_price_thb: '1.2000' } });

    // stale draft version: refused, nothing published
    const confirm = line.button(preview, CONFIRM);
    expect(confirm).toBe(`action=draft_confirm&id=${ready.id}&v=${ready.version}`);
    const stale = await line.postback(`action=draft_confirm&id=${ready.id}&v=${ready.version - 1}`);
    expect(stale[0]!.text).toBe(ERROR_TABLE.STALE_VERSION.messageTh);
    expect(await e.count(`SELECT count(*) AS n FROM material_listings WHERE org_id = $1`, [org.org_id])).toBe(0);

    // the real button publishes; a replayed webhook and a second tap add nothing
    const sent = await line.send({ type: 'postback', postback: { data: confirm } });
    await e.runJobs(); await e.flushOutbox();
    expect(line.inbox().at(-1)?.text).toContain('เผยแพร่เรียบร้อย');
    const events = await e.count(`SELECT count(*) AS n FROM webhook_events`);
    const jobs = await e.count(`SELECT count(*) AS n FROM jobs`);
    expect(await line.resend(sent.raw)).toBe(200);
    await e.runJobs(); await e.flushOutbox();
    expect(await e.count(`SELECT count(*) AS n FROM webhook_events`)).toBe(events);
    expect(await e.count(`SELECT count(*) AS n FROM jobs`)).toBe(jobs);
    await line.postback(confirm); // a new tap = a new event
    expect(await e.count(`SELECT count(*) AS n FROM material_listings WHERE org_id = $1`, [org.org_id])).toBe(1);
    expect(await e.count(`SELECT count(*) AS n FROM jobs WHERE kind = 'recompute_matches' AND payload->>'entity_type' = 'LISTING'`)).toBeGreaterThanOrEqual(1);
    const [listing] = await sql(`SELECT status, total_qty_kg::text AS total, remaining_qty_kg::text AS remaining, lat, lng FROM material_listings WHERE org_id = $1`, [org.org_id]);
    expect(listing).toMatchObject({ status: 'PUBLISHED', total: '10000.000', remaining: '10000.000' });
  });

  it('the factory sees the match with a straight-line distance and no farmer identity or contact', async () => {
    const farmer = await farmerSells({ location: { lat: 17.62, lng: 100.1 } });
    const { s } = await factoryBuys();
    const m = await matchFor(s, farmer.listingId);
    expect(m).toBeDefined();
    const view = (await e.call(s, 'GET', '/matches?route=1')).body.find((x: { id: string }) => x.id === m!.id);
    expect(view).toMatchObject({
      route: 1, own_side: 'demand',
      distance: { kind: 'straight_line', label_th: 'ระยะเส้นตรง (ไม่ใช่ระยะขับรถ)' },
      counterparty: { entity_type: 'LISTING', display_name: null, org_kind: 'FARMER', province: 'อุตรดิตถ์' },
    });
    expect((view.flags as Array<{ code: string }>).map((f) => f.code)).not.toContain('DISTANCE_UNVERIFIED');
    expect(Number(view.distance.km)).toBeGreaterThan(0);
    expect(Number(view.distance.km)).toBeLessThanOrEqual(80);
    expect(view.counterparty.published).toMatchObject({ remaining_qty_kg: '10000.000', unit_price_thb: '1.2000', price_unit: 'KG' });
    const text = JSON.stringify(view);
    for (const secret of [farmer.orgId, farmer.userId, farmer.line.userId, '17.62', '100.1', 'lat', 'lng', 'phone', 'line_user']) expect(text).not.toContain(secret);
    // the farmer's listing and the factory's demand are not each other's own side
    expect(await e.count(`SELECT count(*) AS n FROM matches WHERE supply_id = $1`, [farmer.listingId])).toBeGreaterThanOrEqual(1);
  });

  it('no coordinates: the match is kept, the distance is unknown and flagged; a price above the buyer limit is flagged, not hidden', async () => {
    const farmer = await farmerSells(); // no location shared
    const { s } = await factoryBuys({ maxPrice: '0.8' }); // farmer asks 1.2, plant pays up to 0.8
    const view = (await e.call(s, 'GET', '/matches?route=1')).body.find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === farmer.listingId);
    expect(view).toBeDefined();
    expect(view.distance).toBeNull();
    expect(view.tier).toBe(1);
    const codes = (view.flags as Array<{ code: string }>).map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['DISTANCE_UNVERIFIED', 'PRICE_MISMATCH']));
  });

  it('offer -> LINE push with buttons -> farmer accepts a partial quantity -> agreement for both, listing reduced, repeats add nothing', async () => {
    const farmer = await farmerSells({ location: { lat: 17.62, lng: 100.1 } });
    const { s: factory, demandId } = await factoryBuys({ name: 'synthetic-plant-direct' });
    const match = await matchFor(factory, farmer.listingId);

    const created = await offerFrom(factory, match!.id, '4000');
    expect(created.status).toBe(201);
    const offer = created.body.offer;
    expect(offer).toMatchObject({ kind: 'PURCHASE', status: 'PENDING', qty_kg: '4000.000', total_amount_thb: '4800.00', to_org_id: farmer.orgId, from_org_id: factory.orgId, listing_id: farmer.listingId, demand_id: demandId });
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(0);

    // the farmer's push: terms only, no factory contact, two buttons that carry the offer version
    await e.flushOutbox();
    const push = farmer.line.inbox().at(-1)!;
    expect(push.text).toContain('มีข้อเสนอใหม่');
    expect(push.text).toContain('ปริมาณ: 4000.000 กก.');
    expect(push.text).toContain('ยอดรวม: 4800.00 บาท (ไม่รวมค่าขนส่ง)');
    expect(push.quickReply.items.map((i: { action: { label: string } }) => i.action.label)).toEqual([ACCEPT, REJECT]);
    const accept = buttonFor(farmer.line, offer.id, ACCEPT);
    expect(accept).toBe(`action=offer_accept&id=${offer.id}&v=${offer.version}`);
    expect(JSON.stringify(push)).not.toContain(factory.orgId);

    const ledger = await e.count(`SELECT count(*) AS n FROM quantity_ledger`);
    const reply = await farmer.line.postback(accept);
    expect(allText(reply)).toContain('ยืนยันข้อตกลงแล้ว');
    expect(allText(reply)).toContain('ปริมาณตามข้อตกลง: 4000.000 กก.');
    expect(allText(reply)).toContain('ไม่ใช่หลักฐานการชำระเงิน');

    // visible to the factory over HTTP and to the farmer's organization in the database; not to anyone else
    const list = await e.call(factory, 'GET', '/agreements');
    expect(list.body).toHaveLength(1);
    const agreement = list.body[0];
    expect(agreement).toMatchObject({ kind: 'PURCHASE', status: 'PURCHASE_CONFIRMED', qty_kg: '4000.000', seller_org_id: farmer.orgId, buyer_org_id: factory.orgId, listing_id: farmer.listingId, demand_id: demandId });
    expect((await e.call(factory, 'GET', `/agreements/${agreement.id}`)).status).toBe(200);
    const [row] = await sql(`SELECT seller_org_id, buyer_org_id, status FROM agreements WHERE id = $1`, [agreement.id]);
    expect(row).toMatchObject({ seller_org_id: farmer.orgId, buyer_org_id: factory.orgId, status: 'PURCHASE_CONFIRMED' });
    expect((await e.call(factory, 'GET', `/offers/${offer.id}`)).body.status).toBe('ACCEPTED');

    // partial quantity: 10 t listed, 4 t agreed, 6 t still for sale; the plant's remaining demand drops by the same amount
    expect(await listingRow(farmer.listingId)).toMatchObject({ status: 'PUBLISHED', total: '10000.000', committed: '4000.000', remaining: '6000.000' });
    expect((await sql(`SELECT remaining_qty_kg::text AS r FROM purchase_demands WHERE id = $1`, [demandId]))[0].r).toBe('46000.000');
    expect(await e.count(`SELECT count(*) AS n FROM quantity_ledger`)).toBeGreaterThan(ledger);

    // the accept queued a recompute for the new listing version (the LINE step already ran it), so the 6 t still for sale
    // keep their match: stored rows of an older version are hidden
    expect(await e.count(`SELECT count(*) AS n FROM jobs WHERE kind = 'recompute_matches' AND status = 'DONE' AND payload->>'entity_id' = $1 AND (payload->>'version')::int >= 2`, [farmer.listingId])).toBe(1);
    const after = (await e.call(factory, 'GET', '/matches?route=1')).body.find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === farmer.listingId);
    expect(after?.counterparty.published.remaining_qty_kg).toBe('6000.000');

    // the farmer was also told by push that the agreement is confirmed (accepted event)
    expect(farmer.line.inbox().some((m) => String(m.text).includes('ข้อเสนอได้รับการตอบรับ'))).toBe(true);

    // replayed webhook, double tap with the same button, and a tap with a new event id: nothing extra is written
    const ledgerAfter = await e.count(`SELECT count(*) AS n FROM quantity_ledger`);
    const sent = await farmer.line.send({ type: 'postback', postback: { data: accept } });
    await e.runJobs(); await e.flushOutbox();
    expect(await farmer.line.resend(sent.raw)).toBe(200);
    await e.runJobs(); await e.flushOutbox();
    const again = await farmer.line.postback(accept);
    expect(allText(again)).toContain('ยืนยันข้อตกลงแล้ว');
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(1);
    expect(await e.count(`SELECT count(*) AS n FROM quantity_ledger`)).toBe(ledgerAfter);
    expect(await listingRow(farmer.listingId)).toMatchObject({ committed: '4000.000', remaining: '6000.000' });
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE listing_id = $1`, [farmer.listingId])).toBe(1);
  });

  it('two plants offer more than what is left: the second accept gets INSUFFICIENT_QUANTITY and its offer stays PENDING', async () => {
    const farmer = await farmerSells({ location: { lat: 17.62, lng: 100.1 }, qtyTon: '10' });
    const a = await factoryBuys({ name: 'synthetic-plant-race-a' });
    const b = await factoryBuys({ name: 'synthetic-plant-race-b', maxPrice: '1.3' });
    const first = (await offerFrom(a.s, (await matchFor(a.s, farmer.listingId))!.id, '4000')).body.offer;
    await e.flushOutbox();
    expect(allText(await farmer.line.postback(buttonFor(farmer.line, first.id, ACCEPT)))).toContain('ยืนยันข้อตกลงแล้ว');
    expect((await listingRow(farmer.listingId)).remaining).toBe('6000.000');
    await e.runJobs(); // the accept changed the listing, so its matches are recomputed (stale rows stay hidden until then)

    // both fit when sent (6000 left) but not together (8000)
    const o1 = (await offerFrom(a.s, (await matchFor(a.s, farmer.listingId))!.id, '4000')).body.offer;
    const o2 = (await offerFrom(b.s, (await matchFor(b.s, farmer.listingId))!.id, '4000', '1.25')).body.offer;
    expect([o1.status, o2.status]).toEqual(['PENDING', 'PENDING']);
    await e.flushOutbox();
    const before = farmer.line.inbox().length;
    await farmer.line.send({ type: 'postback', postback: { data: buttonFor(farmer.line, o1.id, ACCEPT) } });
    await farmer.line.send({ type: 'postback', postback: { data: buttonFor(farmer.line, o2.id, ACCEPT) } });
    await e.runJobsConcurrently(); // both taps handled at the same time, by two runners
    await e.runJobs();
    await e.flushOutbox();

    const statuses = (await sql(`SELECT id, status FROM offers WHERE id = ANY($1)`, [[o1.id, o2.id]])) as Array<{ id: string; status: string }>;
    expect(statuses.map((r) => r.status).sort()).toEqual(['ACCEPTED', 'PENDING']);
    const loser = statuses.find((r) => r.status === 'PENDING')!;
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = ANY($1)`, [[o1.id, o2.id]])).toBe(1);
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [loser.id])).toBe(0);
    expect(await listingRow(farmer.listingId)).toMatchObject({ committed: '8000.000', remaining: '2000.000' }); // never below zero
    const replies = farmer.line.inbox().slice(before).map((m) => String(m.text));
    expect(replies.some((t) => t === ERROR_TABLE.INSUFFICIENT_QUANTITY.messageTh)).toBe(true);
    expect(replies.some((t) => t.includes('ยืนยันข้อตกลงแล้ว'))).toBe(true);
    // the loser's offer is untouched and still answerable (a smaller one could be sent instead)
    expect((await sql(`SELECT version FROM offers WHERE id = $1`, [loser.id]))[0].version).toBe(1);
  });

  it('the farmer rejects an offer with the button: REJECTED, no agreement, no quantity moves; a repeated tap changes nothing', async () => {
    const farmer = await farmerSells({ location: { lat: 17.62, lng: 100.1 } });
    const { s } = await factoryBuys({ name: 'synthetic-plant-reject' });
    const offer = (await offerFrom(s, (await matchFor(s, farmer.listingId))!.id, '3000')).body.offer;
    await e.flushOutbox();
    const reject = buttonFor(farmer.line, offer.id, REJECT);
    const reply = await farmer.line.postback(reject);
    expect(reply[0]!.text).toContain('ปฏิเสธข้อเสนอแล้ว');
    expect((await e.call(s, 'GET', `/offers/${offer.id}`)).body.status).toBe('REJECTED');
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(0);
    expect(await listingRow(farmer.listingId)).toMatchObject({ committed: '0.000', remaining: '10000.000' });
    expect((await farmer.line.postback(reject))[0]!.text).toContain('ปฏิเสธข้อเสนอแล้ว');
    // an answered offer cannot be accepted afterwards
    const late = await farmer.line.postback(buttonFor(farmer.line, offer.id, ACCEPT));
    expect(late[0]!.text).not.toContain('ยืนยันข้อตกลงแล้ว');
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(0);
  });

  it('other organizations cannot read or answer the offer and agreement: 404 over HTTP, "not found" in LINE', async () => {
    const farmer = await farmerSells({ location: { lat: 17.62, lng: 100.1 } });
    const owner = await factoryBuys({ name: 'synthetic-plant-owner' });
    const other = await factoryBuys({ name: 'synthetic-plant-other' });
    const offer = (await offerFrom(owner.s, (await matchFor(owner.s, farmer.listingId))!.id, '2000')).body.offer;
    await e.flushOutbox();
    const accept = buttonFor(farmer.line, offer.id, ACCEPT);

    // another factory and another farmer's Dashboard session
    const outsider = await e.loginAs('FARMER');
    for (const s of [other.s, outsider]) {
      expect((await e.call(s, 'GET', `/offers/${offer.id}`)).status).toBe(404);
      expect((await e.call(s, 'POST', `/offers/${offer.id}/accept`, {})).status).toBe(404);
      expect((await e.call(s, 'POST', `/offers/${offer.id}/reject`, {})).status).toBe(404);
    }
    // the sender cannot accept its own offer
    expect((await e.call(owner.s, 'POST', `/offers/${offer.id}/accept`, {})).status).toBe(404);
    // another farmer in LINE pressing this farmer's button
    const stranger = e.farmer(uid());
    await stranger.follow();
    const denied = await stranger.postback(accept);
    expect(denied[0]!.text).toBe(ERROR_TABLE.NOT_FOUND.messageTh);
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(0);
    expect((await e.call(owner.s, 'GET', `/offers/${offer.id}`)).body.status).toBe('PENDING');

    // the real farmer accepts; only the two parties see the agreement
    expect(allText(await farmer.line.postback(accept))).toContain('ยืนยันข้อตกลงแล้ว');
    const [{ id: agreementId }] = await sql(`SELECT id FROM agreements WHERE offer_id = $1`, [offer.id]);
    expect((await e.call(owner.s, 'GET', `/agreements/${agreementId}`)).status).toBe(200);
    for (const s of [other.s, outsider]) {
      expect((await e.call(s, 'GET', `/agreements/${agreementId}`)).status).toBe(404);
      expect((await e.call(s, 'GET', '/agreements')).body).toEqual([]);
    }
  });
});
