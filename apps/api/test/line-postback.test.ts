import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  POSTBACK_ACTIONS,
  POSTBACK_MAX_LENGTH,
  ROLE_POSTBACK_ACTIONS,
  decodePostback,
  encodePostback,
  isPostbackActionAllowed,
} from '../src/channels/line/codec.js';
import {
  AGREEMENT_NOTICE,
  ASSESSMENT_DISCLAIMER,
  assessmentText,
  buildAgreementNotice,
  buildDraftPreview,
  buildMatchCard,
  buildOfferCard,
} from '../src/channels/line/messages.js';
import { PRICE_UNITS } from '../src/domain/units.js';

const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/);
const postbackArb = fc.record(
  { action: fc.constantFrom(...POSTBACK_ACTIONS), id: idArb, version: fc.integer({ min: 0, max: 999_999_999 }) },
  { requiredKeys: ['action', 'id'] },
);

describe('postback codec', () => {
  it('encodes the documented wire format', () => {
    expect(encodePostback({ action: 'draft_confirm', id: 'abc', version: 3 })).toBe('action=draft_confirm&id=abc&v=3');
    expect(encodePostback({ action: 'offer_reject', id: 'abc' })).toBe('action=offer_reject&id=abc');
  });

  it('rejects unknown actions, tampered and malformed data without throwing', () => {
    for (const bad of [
      'action=delete_everything&id=1',
      'action=offer_accept',
      'id=1&action=offer_accept',
      'action=offer_accept&id=1&v=01',
      'action=offer_accept&id=1&v=-1',
      'action=offer_accept&id=1&v=1&x=2',
      'action=offer_accept&id=a%2Fb',
      'action=offer_accept&id=',
      '',
    ]) {
      expect(decodePostback(bad).ok).toBe(false);
    }
    expect(decodePostback(undefined).ok).toBe(false);
    expect(decodePostback(`action=offer_accept&id=${'a'.repeat(400)}`)).toEqual({ ok: false, code: 'TOO_LONG' });
    expect(decodePostback('action=nope&id=1')).toEqual({ ok: false, code: 'UNKNOWN_ACTION' });
  });

  it('refuses to encode over-long or invalid input', () => {
    expect(() => encodePostback({ action: 'offer_accept', id: 'a'.repeat(65) })).toThrow();
  });

  it('keeps an allow-list per role', () => {
    for (const actions of Object.values(ROLE_POSTBACK_ACTIONS)) {
      for (const a of actions) expect(POSTBACK_ACTIONS).toContain(a);
    }
    expect(isPostbackActionAllowed('FARMER', 'offer_accept')).toBe(true);
  });
});

describe('postback codec properties', () => {
  // **Validates: Requirements 11.9, 2.4**
  it('decode(encode(x)) equals x and stays within the LINE limit', () => {
    fc.assert(
      fc.property(postbackArb, (x) => {
        const data = encodePostback(x);
        expect(data.length).toBeLessThanOrEqual(POSTBACK_MAX_LENGTH);
        expect(decodePostback(data)).toEqual({ ok: true, value: x });
      }),
    );
  });

  it('never throws and only accepts canonical encodings', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary', maxLength: 400 })), (s) => {
        const r = decodePostback(s);
        if (r.ok) expect(encodePostback(r.value)).toBe(s);
      }),
    );
  });

  it('rejects any mutation of a valid encoding that leaves a non-canonical string', () => {
    fc.assert(
      fc.property(postbackArb, fc.nat(), fc.constantFrom('%', '&', '=', ' ', '/', 'é'), (x, pos, ch) => {
        const data = encodePostback(x);
        const i = pos % (data.length + 1);
        const mutated = data.slice(0, i) + ch + data.slice(i);
        const r = decodePostback(mutated);
        if (r.ok) expect(encodePostback(r.value)).toBe(mutated);
      }),
    );
  });

  it('rejects data over 300 characters', () => {
    fc.assert(
      fc.property(fc.string({ minLength: POSTBACK_MAX_LENGTH + 1, maxLength: 600 }), (s) => {
        expect(decodePostback(s).ok).toBe(false);
      }),
    );
  });
});

describe('message builders', () => {
  const labels = (m: { quickReply?: { items: readonly { action: { label: string } }[] } }) =>
    (m.quickReply?.items ?? []).map((i) => i.action.label);

  it('draft preview offers the three buttons with the version', () => {
    const m = buildDraftPreview({ draftId: 'd1', version: 4, title: 'ฟางข้าว', summaryLines: ['ปริมาณ 1000 กก.'] });
    expect(labels(m)).toEqual(['ยืนยันเผยแพร่', 'แก้ไข', 'เก็บร่าง']);
    const confirm = m.quickReply!.items[0]!.action.data;
    expect(decodePostback(confirm)).toEqual({ ok: true, value: { action: 'draft_confirm', id: 'd1', version: 4 } });
  });

  it('draft preview with image assessment carries the disclaimer', () => {
    const m = buildDraftPreview({ draftId: 'd1', version: 1, title: 't', summaryLines: [], assessmentLines: ['แห้งดี'] });
    expect(m.text).toContain(ASSESSMENT_DISCLAIMER);
    expect(assessmentText([])).toContain(ASSESSMENT_DISCLAIMER);
  });

  it('agreement notice has the not-payment text and no paid/delivered claims', () => {
    const m = buildAgreementNotice({ agreementId: 'a1', quantityText: '500', remainingText: '500' });
    expect(m.text).toContain(AGREEMENT_NOTICE);
    expect(m.text).not.toMatch(/ชำระแล้ว|จ่ายแล้ว|ส่งมอบแล้ว|ผ่านการตรวจ/);
  });

  it('match card labels estimates and keeps the straight-line wording', () => {
    const m = buildMatchCard({
      counterpartyName: 'โรงไฟฟ้า A',
      materialLabel: 'ฟางข้าว',
      distanceKmText: '42.5',
      reasons: ['ราคาอยู่ในช่วง'],
      estimates: [{ label: 'รายได้สุทธิ', valueText: '12,000 บาท' }],
    });
    expect(m.text).toContain('ระยะเส้นตรง 42.5 กม.');
    expect(m.text).toContain('ประมาณการ: รายได้สุทธิ 12,000 บาท');
  });

  // **Validates: Requirements 11.9**
  it('offer card always shows quantity, price, unit, transport and both buttons', () => {
    fc.assert(
      fc.property(
        idArb,
        fc.nat(1000),
        fc.stringMatching(/^[0-9]{1,7}(\.[0-9]{1,3})?$/),
        fc.stringMatching(/^[0-9]{1,5}(\.[0-9]{1,4})?$/),
        fc.constantFrom(...PRICE_UNITS),
        fc.constantFrom('SELLER', 'BUYER', 'EITHER', 'UNKNOWN' as const),
        (id, version, qty, price, unit, transportBy) => {
          const m = buildOfferCard({
            offerId: id,
            version,
            senderName: 'ผู้ส่ง',
            quantityText: qty,
            priceText: price,
            priceUnit: unit,
            transportBy: transportBy as 'SELLER' | 'BUYER' | 'EITHER' | 'UNKNOWN',
          });
          expect(m.text).toContain(`${qty} กก.`);
          expect(m.text).toContain(price);
          expect(m.text).toMatch(/บาท\/(กก\.|ตัน|ก้อน)/);
          expect(m.text).toContain('ขนส่ง');
          expect(labels(m)).toEqual(['ตอบรับ', 'ปฏิเสธ']);
          const actions = m.quickReply!.items.map((i) => decodePostback(i.action.data));
          expect(actions.map((a) => a.ok && a.value.action)).toEqual(['offer_accept', 'offer_reject']);
        },
      ),
    );
  });

  it('offer card shows transport cost separately from the total', () => {
    const m = buildOfferCard({
      offerId: 'o1', version: 1, senderName: 's', quantityText: '1000', priceText: '2', priceUnit: 'THB_PER_KG',
      transportBy: 'SELLER', transportCostText: '300', totalText: '2000',
    });
    expect(m.text).toContain('ค่าขนส่งแยกต่างหาก: 300 บาท');
    expect(m.text).toContain('ไม่รวมค่าขนส่ง');
  });
});
