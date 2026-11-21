// Story 2 end to end (task 14.2): a baling service agreement. Real Postgres, real app, real services.
// Baler: the Dashboard over HTTP (session cookie + CSRF). Farmer: LINE only, through signed webhook requests, the
// line_event job and the farmer handler. The baling request is created through the assistant (MockBedrock):
// the farmer handler and the assistant's patch_draft tool already handle the BALING_REQUEST kind, so the step form is not needed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_TABLE } from '../src/services/errors.js';
import { allText, createE2e, type E2e, type FarmerLine, type Session, turn } from './e2e-harness.js';
import { testDatabaseUrl } from './db-helper.js';

const CONFIRM = 'ยืนยันเผยแพร่';
const ACCEPT = 'ตอบรับ';
const SERVICE_PATCH = {
  material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'FIXED', price: { value: '0.5', unit: 'kg' },
  province: 'Uttaradit', service_provinces: ['Uttaradit'], min_quantity: { value: '100', unit: 'kg' },
};

describe.skipIf(!testDatabaseUrl)('story 2: baling service, baler on the Dashboard, farmer in LINE', () => {
  let e: E2e;
  let n = 0;
  beforeAll(async () => { e = await createE2e(); });
  afterAll(async () => { await e?.close(); });
  const sql = (q: string, p: unknown[] = []) => e.db.pool.query(q, p).then((r) => r.rows);

  async function balerPublishes(): Promise<{ s: Session; serviceId: string }> {
    const s = await e.loginAs('BALER', `synthetic-baler-${++n}`);
    const d = await e.call(s, 'POST', '/drafts', { kind: 'BALING_SERVICE', patch: SERVICE_PATCH });
    expect(d.status).toBe(201);
    const p = await e.call(s, 'POST', `/drafts/${d.body.draft.id}/publish`, { expectedVersion: d.body.draft.version });
    expect(p.status).toBe(200);
    expect(p.body.entity_type).toBe('BALING_SERVICE');
    await e.runJobs();
    return { s, serviceId: p.body.entity_id as string };
  }

  async function farmerRequests(): Promise<{ line: FarmerLine; orgId: string; userId: string; requestId: string }> {
    const line = e.farmer(`U-synthetic-e2e-baling-farmer-${++n}-${Date.now()}`);
    await line.follow();
    e.script(turn('BALING_REQUEST', { material_type: 'RICE_STRAW', quantity: { value: '5', unit: 'ton' }, requested_mode: 'ON_SITE', province: 'Uttaradit' }));
    const preview = await line.text('อยากให้อัดฟางข้าว 5 ตัน ที่แปลง อุตรดิตถ์');
    expect(preview[0]!.text).toContain('คำขอให้อัดฟาง');
    await line.postback(line.button(preview, CONFIRM));
    const org = await line.org();
    const [row] = await sql(`SELECT id FROM baling_requests WHERE org_id = $1`, [org.org_id]);
    expect(row).toBeDefined();
    await e.runJobs(); // recompute_matches for the request
    return { line, orgId: org.org_id, userId: org.user_id, requestId: row.id as string };
  }

  const buttonFor = (line: FarmerLine, offerId: string, label: string): string => {
    for (const m of line.inbox()) {
      for (const i of m.quickReply?.items ?? []) if (i.action.label === label && String(i.action.data).includes(`id=${offerId}&`)) return i.action.data as string;
    }
    throw new Error(`no "${label}" button for offer ${offerId}`);
  };

  it('baler publishes on the Dashboard, farmer requests in LINE, route 3 matches, baler offers, farmer accepts: SERVICE_CONFIRMED only', async () => {
    const baler = await balerPublishes();
    const farmer = await farmerRequests();
    expect(farmer.requestId).toBeTruthy();

    // route 3 match: the baler sees the request without any farmer identity
    const matches = await e.call(baler.s, 'GET', '/matches?route=3');
    const match = matches.body.find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === farmer.requestId);
    expect(match).toMatchObject({ route: 3, own_entity_id: baler.serviceId, counterparty: { entity_type: 'BALING_REQUEST', display_name: null, org_kind: 'FARMER' } });
    const text = JSON.stringify(match);
    for (const secret of [farmer.orgId, farmer.userId, farmer.line.userId]) expect(text).not.toContain(secret);

    // the farmer asks the assistant about matches in LINE: the numbers come from the backend, not from the model
    e.script({ type: 'json', value: { intent: 'FIND_BALER', reply_text: 'ผมหาให้' } });
    const explained = await farmer.line.text('มีใครรับอัดบ้าง');
    expect(explained.length).toBeGreaterThan(0);

    // the baler offers from the match
    const ledger = await e.count(`SELECT count(*) AS n FROM quantity_ledger`);
    const listings = await e.count(`SELECT count(*) AS n FROM material_listings`);
    const created = await e.call(baler.s, 'POST', '/offers', { kind: 'BALING_SERVICE', matchId: match.id, qtyKg: '4000', unitPriceThb: '0.5', priceUnit: 'KG' });
    expect(created.status).toBe(201);
    const offer = created.body.offer;
    expect(offer).toMatchObject({ kind: 'BALING_SERVICE', status: 'PENDING', from_org_id: baler.s.orgId, to_org_id: farmer.orgId, total_amount_thb: '2000.00', baling_service_id: baler.serviceId, baling_request_id: farmer.requestId });

    // the farmer receives the offer with accept and reject buttons
    await e.flushOutbox();
    const push = farmer.line.inbox().at(-1)!;
    expect(push.text).toContain('มีข้อเสนอใหม่');
    expect(push.text).toContain('ยอดรวม: 2000.00 บาท (ไม่รวมค่าขนส่ง)');
    const accept = buttonFor(farmer.line, offer.id, ACCEPT);

    // the baler cannot accept its own offer; another organization sees nothing
    expect((await e.call(baler.s, 'POST', `/offers/${offer.id}/accept`, {})).status).toBe(404);
    const outsider = await e.loginAs('FARMER');
    expect((await e.call(outsider, 'GET', `/offers/${offer.id}`)).status).toBe(404);

    const reply = await farmer.line.postback(accept);
    expect(allText(reply)).toContain('ยืนยันข้อตกลงแล้ว');
    const agreement = (await e.call(baler.s, 'GET', '/agreements?kind=BALING_SERVICE')).body[0];
    expect(agreement).toMatchObject({
      kind: 'BALING_SERVICE', status: 'SERVICE_CONFIRMED', seller_org_id: baler.s.orgId, buyer_org_id: farmer.orgId,
      baling_service_id: baler.serviceId, baling_request_id: farmer.requestId, listing_id: null, demand_id: null,
      qty_kg: '4000.000', resale_reserved_kg: '0.000',
    });
    expect((await e.call(baler.s, 'GET', '/agreements?kind=PURCHASE')).body).toEqual([]);
    expect((await e.call(outsider, 'GET', `/agreements/${agreement.id}`)).status).toBe(404);
    const [stored] = await sql(`SELECT seller_org_id, buyer_org_id, status, source_agreement_id FROM agreements WHERE id = $1`, [agreement.id]);
    expect(stored).toMatchObject({ seller_org_id: baler.s.orgId, buyer_org_id: farmer.orgId, status: 'SERVICE_CONFIRMED', source_agreement_id: null });

    // no quantity or ledger writes, no stock for the baler, the farmer's request keeps its quantity: ownership is unchanged
    expect(await e.count(`SELECT count(*) AS n FROM quantity_ledger`)).toBe(ledger);
    expect(await e.count(`SELECT count(*) AS n FROM material_listings`)).toBe(listings);
    expect(await e.count(`SELECT count(*) AS n FROM material_listings WHERE org_id = $1`, [baler.s.orgId])).toBe(0);
    const [req] = await sql(`SELECT status, qty_kg::text AS qty, version, org_id FROM baling_requests WHERE id = $1`, [farmer.requestId]);
    expect(req).toMatchObject({ status: 'PUBLISHED', qty: '5000.000', version: 1, org_id: farmer.orgId });

    // wording: the confirmation is a service agreement, not a claim that the straw is baled, paid or delivered
    const all = JSON.stringify(farmer.line.inbox().filter((m) => String(m.text).includes('ยืนยัน')));
    expect(all).toContain('ยืนยันบริการอัด — ไม่ใช่หลักฐานว่าอัดเสร็จแล้ว');
    // the farmer's own reply says the same, and does not use the purchase wording
    expect(allText(reply)).toContain('ยืนยันบริการอัด — ไม่ใช่หลักฐานว่าอัดเสร็จแล้ว');
    expect(allText(reply)).not.toContain('การรับซื้อในระบบ');
    expect(allText(reply).replaceAll('ไม่ใช่หลักฐานว่าอัดเสร็จแล้ว', '')).not.toMatch(/อัดเสร็จแล้ว|ชำระแล้ว|ส่งมอบแล้ว/);

    // replayed webhook, double tap and a tap with a new event id create nothing extra
    const sent = await farmer.line.send({ type: 'postback', postback: { data: accept } });
    await e.runJobs(); await e.flushOutbox();
    expect(await farmer.line.resend(sent.raw)).toBe(200);
    await e.runJobs(); await e.flushOutbox();
    expect(allText(await farmer.line.postback(accept))).toContain('ยืนยันข้อตกลงแล้ว');
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(1);
    expect(await e.count(`SELECT count(*) AS n FROM quantity_ledger`)).toBe(ledger);
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE baling_request_id = $1`, [farmer.requestId])).toBe(1);
  });

  it('the farmer rejects the baler offer in LINE: REJECTED, no agreement, and the request stays open', async () => {
    const baler = await balerPublishes();
    const farmer = await farmerRequests();
    const matchId = (await e.call(baler.s, 'GET', '/matches?route=3')).body
      .find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === farmer.requestId).id as string;
    const offer = (await e.call(baler.s, 'POST', '/offers', { kind: 'BALING_SERVICE', matchId, qtyKg: '2000', unitPriceThb: '0.5', priceUnit: 'KG' })).body.offer;
    await e.flushOutbox();
    const reply = await farmer.line.postback(buttonFor(farmer.line, offer.id, 'ปฏิเสธ'));
    expect(reply[0]!.text).toContain('ปฏิเสธข้อเสนอแล้ว');
    expect((await e.call(baler.s, 'GET', `/offers/${offer.id}`)).body.status).toBe('REJECTED');
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE baling_request_id = $1`, [farmer.requestId])).toBe(0);
    expect((await sql(`SELECT status FROM baling_requests WHERE id = $1`, [farmer.requestId]))[0].status).toBe('PUBLISHED');
  });

  it('a stale offer button is refused and a farmer cannot answer another farmer\'s baling offer', async () => {
    const baler = await balerPublishes();
    const farmer = await farmerRequests();
    const matchId = (await e.call(baler.s, 'GET', '/matches?route=3')).body
      .find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === farmer.requestId).id as string;
    const offer = (await e.call(baler.s, 'POST', '/offers', { kind: 'BALING_SERVICE', matchId, qtyKg: '1000', unitPriceThb: '0.5', priceUnit: 'KG' })).body.offer;
    await e.flushOutbox();
    const stale = await farmer.line.postback(`action=offer_accept&id=${offer.id}&v=${offer.version + 4}`);
    expect(stale[0]!.text).toBe(ERROR_TABLE.STALE_VERSION.messageTh);
    const other = e.farmer(`U-synthetic-e2e-baling-other-${++n}-${Date.now()}`);
    await other.follow();
    expect((await other.postback(buttonFor(farmer.line, offer.id, ACCEPT)))[0]!.text).toBe(ERROR_TABLE.NOT_FOUND.messageTh);
    expect(await e.count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(0);
  });
});
