import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as draft from '../src/domain/state/draft.js';
import * as offer from '../src/domain/state/offer.js';
import * as agreement from '../src/domain/state/agreement.js';
import * as resale from '../src/domain/state/resale.js';

const FORBIDDEN = ['DELIVERED', 'PAID', 'COMPLETED'];

describe('state tables', () => {
  it('contain no DELIVERED, PAID or COMPLETED state', () => {
    const all = [...draft.DRAFT_STATES, ...offer.OFFER_STATES, ...agreement.AGREEMENT_STATES];
    for (const f of FORBIDDEN) expect(all).not.toContain(f);
  });

  it('offer: only PENDING moves, to the four documented states', () => {
    expect(offer.next('PENDING', 'ACCEPT')).toEqual({ ok: true, state: 'ACCEPTED' });
    expect(offer.next('PENDING', 'REJECT')).toEqual({ ok: true, state: 'REJECTED' });
    expect(offer.next('PENDING', 'WITHDRAW')).toEqual({ ok: true, state: 'WITHDRAWN' });
    expect(offer.next('PENDING', 'EXPIRE')).toEqual({ ok: true, state: 'EXPIRED' });
    fc.assert(
      fc.property(
        fc.constantFrom(...offer.OFFER_STATES.filter((s) => s !== 'PENDING')),
        fc.constantFrom(...offer.OFFER_EVENTS),
        (s, e) => !offer.next(s, e).ok,
      ),
    );
  });

  it('draft: documented path and rejected shortcuts', () => {
    let s: draft.DraftState = 'DRAFT';
    for (const e of ['COMPLETE', 'PUBLISH', 'PAUSE', 'RESUME', 'CLOSE'] as const) {
      const r = draft.next(s, e);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(s).toBe('CLOSED');
    expect(draft.next('DRAFT', 'PUBLISH').ok).toBe(false);
    expect(draft.next('AWAITING_REVIEW', 'EDIT')).toEqual({ ok: true, state: 'DRAFT' });
    for (const e of draft.DRAFT_EVENTS) {
      expect(draft.next('CLOSED', e).ok).toBe(false);
      expect(draft.next('CANCELLED', e).ok).toBe(false);
    }
  });

  it('draft: random event sequences never leave the state set and terminals stay put', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...draft.DRAFT_EVENTS), { maxLength: 30 }), (events) => {
        let s: draft.DraftState = 'DRAFT';
        for (const e of events) {
          const r = draft.next(s, e);
          if (r.ok) s = r.state;
          expect(draft.DRAFT_STATES).toContain(s);
        }
        if (s === 'CLOSED' || s === 'CANCELLED') {
          for (const e of draft.DRAFT_EVENTS) expect(draft.next(s, e).ok).toBe(false);
        }
      }),
    );
  });

  it('agreement: cancel, review and keep follow the table', () => {
    expect(agreement.initialAgreementState('PURCHASE')).toBe('PURCHASE_CONFIRMED');
    expect(agreement.initialAgreementState('BALING_SERVICE')).toBe('SERVICE_CONFIRMED');
    expect(agreement.next('PURCHASE_CONFIRMED', 'SOURCE_CANCELLED')).toEqual({ ok: true, state: 'NEEDS_REVIEW' });
    expect(agreement.next('NEEDS_REVIEW', 'KEEP')).toEqual({ ok: true, state: 'PURCHASE_CONFIRMED' });
    expect(agreement.next('SERVICE_CONFIRMED', 'SOURCE_CANCELLED').ok).toBe(false);
    expect(agreement.next('CANCELLED', 'KEEP').ok).toBe(false);
  });

  it('resale: source cancellation pauses a published listing only', () => {
    expect(resale.next('PUBLISHED', 'SOURCE_AGREEMENT_CANCELLED')).toEqual({ ok: true, state: 'PAUSED' });
    expect(resale.next('CLOSED', 'SOURCE_AGREEMENT_CANCELLED').ok).toBe(false);
    expect(resale.next('PUBLISHED', 'CLOSE')).toEqual({ ok: true, state: 'CLOSED' });
  });

  it('error carries machine, from and event', () => {
    const r = offer.next('ACCEPTED', 'REJECT');
    expect(r).toEqual({ ok: false, error: { code: 'INVALID_TRANSITION', machine: 'offer', from: 'ACCEPTED', event: 'REJECT' } });
  });
});

describe('offer.decideAccept', () => {
  const base = { actorOrgId: 'r', receiverOrgId: 'r', quantitySufficient: true } as const;
  it('receiver accepts once', () => {
    expect(offer.decideAccept({ ...base, state: 'PENDING' }).outcome).toBe('ACCEPT');
    expect(offer.decideAccept({ ...base, state: 'ACCEPTED' }).outcome).toBe('ALREADY_ACCEPTED');
  });
  it('sender or other org cannot accept', () => {
    expect(offer.decideAccept({ ...base, state: 'PENDING', actorOrgId: 's' })).toEqual({ outcome: 'NOT_RECEIVER', state: 'PENDING' });
  });
  it('insufficient quantity keeps PENDING', () => {
    expect(offer.decideAccept({ ...base, state: 'PENDING', quantitySufficient: false })).toEqual({
      outcome: 'INSUFFICIENT_QUANTITY',
      state: 'PENDING',
    });
  });
  it('terminal non-accepted states are refused with the current state', () => {
    fc.assert(
      fc.property(fc.constantFrom('REJECTED', 'WITHDRAWN', 'EXPIRED'), fc.boolean(), (state, q) => {
        const d = offer.decideAccept({ ...base, state, quantitySufficient: q });
        return d.outcome === 'NOT_PENDING' && d.state === state;
      }),
    );
  });
});
