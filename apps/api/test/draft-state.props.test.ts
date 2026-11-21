import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DRAFT_EVENTS,
  DRAFT_INITIAL,
  DRAFT_STATES,
  DRAFT_TABLE,
  next,
  type DraftEvent,
  type DraftState,
} from '../src/domain/state/draft.js';

// Feature: agrimatch-mvp, Property 12: Draft and listing state machine with versions
// (pure part only; version checks and publish idempotence live in the service, task 6.3)
// **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 14.6**

const stateArb = fc.constantFrom(...DRAFT_STATES);
const eventArb = fc.constantFrom(...DRAFT_EVENTS);
const eventsArb = fc.array(eventArb, { maxLength: 40 });

function run(events: readonly DraftEvent[]) {
  let s: DraftState = DRAFT_INITIAL;
  const trace: { from: DraftState; event: DraftEvent; to: DraftState }[] = [];
  for (const event of events) {
    const r = next(s, event);
    if (r.ok) {
      trace.push({ from: s, event, to: r.state });
      s = r.state;
    }
  }
  return { state: s, trace };
}

describe('Property 12: draft state machine (pure part)', () => {
  it('next agrees with the table for every state and event, and refusals carry the context', () => {
    fc.assert(
      fc.property(stateArb, eventArb, (s, e) => {
        const expected = DRAFT_TABLE[s][e];
        const r = next(s, e);
        if (expected === undefined) {
          expect(r).toEqual({
            ok: false,
            error: { code: 'INVALID_TRANSITION', machine: 'draft', from: s, event: e },
          });
        } else {
          expect(r).toEqual({ ok: true, state: expected });
        }
      }),
    );
  });

  it('only table transitions occur in any event sequence', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        for (const t of run(events).trace) expect(DRAFT_TABLE[t.from][t.event]).toBe(t.to);
      }),
    );
  });

  it('PUBLISHED is entered only by PUBLISH from AWAITING_REVIEW or RESUME from PAUSED', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        for (const t of run(events).trace.filter((x) => x.to === 'PUBLISHED')) {
          const ok =
            (t.event === 'PUBLISH' && t.from === 'AWAITING_REVIEW') || (t.event === 'RESUME' && t.from === 'PAUSED');
          expect(ok).toBe(true);
        }
      }),
    );
  });

  it('a draft never published directly: the first PUBLISHED is preceded by COMPLETE with no EDIT in between', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const { trace } = run(events);
        const idx = trace.findIndex((t) => t.to === 'PUBLISHED');
        if (idx < 0) return;
        expect(trace[idx]).toMatchObject({ event: 'PUBLISH', from: 'AWAITING_REVIEW' });
        const entered = trace.slice(0, idx).filter((t) => t.to === 'AWAITING_REVIEW');
        expect(entered.length).toBeGreaterThan(0);
        // the last transition before PUBLISH is the COMPLETE that entered review
        expect(trace[idx - 1]).toMatchObject({ event: 'COMPLETE', to: 'AWAITING_REVIEW' });
      }),
    );
  });

  it('an EDIT from DRAFT or AWAITING_REVIEW lands in DRAFT, and PUBLISH is then refused until COMPLETE', () => {
    fc.assert(
      fc.property(fc.constantFrom<DraftState>('DRAFT', 'AWAITING_REVIEW'), (s) => {
        const e = next(s, 'EDIT');
        expect(e).toEqual({ ok: true, state: 'DRAFT' });
        expect(next('DRAFT', 'PUBLISH').ok).toBe(false);
      }),
    );
  });

  it('EDIT is refused once published, paused, closed or cancelled', () => {
    fc.assert(
      fc.property(fc.constantFrom<DraftState>('PUBLISHED', 'PAUSED', 'CLOSED', 'CANCELLED'), (s) => {
        expect(next(s, 'EDIT').ok).toBe(false);
      }),
    );
  });

  it('CLOSED and CANCELLED are terminal under any sequence', () => {
    fc.assert(
      fc.property(fc.constantFrom<DraftState>('CLOSED', 'CANCELLED'), eventsArb, (start, events) => {
        for (const e of events) expect(next(start, e).ok).toBe(false);
      }),
    );
  });

  it('CANCEL is accepted from every non-terminal state', () => {
    for (const s of DRAFT_STATES.filter((x) => x !== 'CLOSED' && x !== 'CANCELLED')) {
      expect(next(s, 'CANCEL')).toEqual({ ok: true, state: 'CANCELLED' });
    }
  });

  it('has no DELIVERED, PAID or COMPLETED state', () => {
    for (const f of ['DELIVERED', 'PAID', 'COMPLETED']) {
      expect(DRAFT_STATES as readonly string[]).not.toContain(f);
      expect(Object.keys(DRAFT_TABLE)).not.toContain(f);
    }
  });
});
