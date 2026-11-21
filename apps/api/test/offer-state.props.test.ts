import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  OFFER_EVENTS,
  OFFER_INITIAL,
  OFFER_STATES,
  OFFER_TABLE,
  decideAccept,
  next,
  type OfferState,
} from '../src/domain/state/offer.js';

// Feature: agrimatch-mvp, Property 11: Offer state machine and expiry
// **Validates: Requirements 11.2, 11.3, 11.6, 11.7, 11.8**

const TERMINAL = OFFER_STATES.filter((s) => s !== 'PENDING');
const stateArb = fc.constantFrom(...OFFER_STATES);
const eventArb = fc.constantFrom(...OFFER_EVENTS);
const orgArb = fc.string({ minLength: 1, maxLength: 8 });

describe('Property 11: offer state machine', () => {
  it('only PENDING can transition, to exactly the table state; otherwise refused', () => {
    fc.assert(
      fc.property(stateArb, eventArb, (s, e) => {
        const r = next(s, e);
        const expected = OFFER_TABLE[s][e];
        if (s === 'PENDING') {
          expect(r).toEqual({ ok: true, state: expected });
        } else {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error).toMatchObject({ code: 'INVALID_TRANSITION', from: s, event: e });
        }
      }),
    );
  });

  it('terminal states stay terminal under any event sequence', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERMINAL), fc.array(eventArb, { maxLength: 20 }), (start, events) => {
        let s: OfferState = start;
        for (const e of events) {
          const r = next(s, e);
          expect(r.ok).toBe(false);
          if (r.ok) s = r.state;
        }
        expect(s).toBe(start);
      }),
    );
  });

  it('any sequence from the initial state reaches at most one terminal state and stays there', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 20 }), (events) => {
        let s: OfferState = OFFER_INITIAL;
        let firstTerminal: OfferState | undefined;
        for (const e of events) {
          const r = next(s, e);
          if (r.ok) s = r.state;
          if (s !== 'PENDING') firstTerminal ??= s;
        }
        if (firstTerminal) expect(s).toBe(firstTerminal);
      }),
    );
  });

  it('has no DELIVERED, PAID or COMPLETED state', () => {
    for (const f of ['DELIVERED', 'PAID', 'COMPLETED']) {
      expect(OFFER_STATES as readonly string[]).not.toContain(f);
      expect(Object.keys(OFFER_TABLE)).not.toContain(f);
    }
  });
});

describe('Property 11: decideAccept', () => {
  it('accept by a non-receiver is never ACCEPT and never changes the state', () => {
    fc.assert(
      fc.property(stateArb, orgArb, orgArb, fc.boolean(), (state, actor, receiver, qty) => {
        fc.pre(actor !== receiver);
        const d = decideAccept({ state, actorOrgId: actor, receiverOrgId: receiver, quantitySufficient: qty });
        expect(d.outcome).toBe('NOT_RECEIVER');
        expect(d.state).toBe(state);
      }),
    );
  });

  it('receiver accepting a PENDING offer with enough quantity gives ACCEPTED', () => {
    fc.assert(
      fc.property(orgArb, (org) => {
        expect(
          decideAccept({ state: 'PENDING', actorOrgId: org, receiverOrgId: org, quantitySufficient: true }),
        ).toEqual({ outcome: 'ACCEPT', state: 'ACCEPTED' });
      }),
    );
  });

  it('repeated accept of an ACCEPTED offer is ALREADY_ACCEPTED regardless of quantity', () => {
    fc.assert(
      fc.property(orgArb, fc.boolean(), (org, qty) => {
        expect(
          decideAccept({ state: 'ACCEPTED', actorOrgId: org, receiverOrgId: org, quantitySufficient: qty }),
        ).toEqual({ outcome: 'ALREADY_ACCEPTED', state: 'ACCEPTED' });
      }),
    );
  });

  it('insufficient quantity keeps PENDING', () => {
    fc.assert(
      fc.property(orgArb, (org) => {
        expect(
          decideAccept({ state: 'PENDING', actorOrgId: org, receiverOrgId: org, quantitySufficient: false }),
        ).toEqual({ outcome: 'INSUFFICIENT_QUANTITY', state: 'PENDING' });
      }),
    );
  });

  it('REJECTED, WITHDRAWN and EXPIRED offers cannot be accepted and keep their state', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('REJECTED', 'WITHDRAWN', 'EXPIRED' as const),
        orgArb,
        fc.boolean(),
        (state, org, qty) => {
          const d = decideAccept({ state, actorOrgId: org, receiverOrgId: org, quantitySufficient: qty });
          expect(d).toEqual({ outcome: 'NOT_PENDING', state });
        },
      ),
    );
  });
});
