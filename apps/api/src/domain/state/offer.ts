// Offer state machine (Requirement 11.3). Only PENDING can move; the other four states are terminal.
import { makeNext, type TransitionTable } from './table.js';

export const OFFER_STATES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as const;
export type OfferState = (typeof OFFER_STATES)[number];

export const OFFER_EVENTS = ['ACCEPT', 'REJECT', 'WITHDRAW', 'EXPIRE'] as const;
export type OfferEvent = (typeof OFFER_EVENTS)[number];

export const OFFER_INITIAL: OfferState = 'PENDING';

export const OFFER_TABLE: TransitionTable<OfferState, OfferEvent> = {
  PENDING: { ACCEPT: 'ACCEPTED', REJECT: 'REJECTED', WITHDRAW: 'WITHDRAWN', EXPIRE: 'EXPIRED' },
  ACCEPTED: {},
  REJECTED: {},
  WITHDRAWN: {},
  EXPIRED: {},
};

export const next = makeNext('offer', OFFER_TABLE);

export type AcceptDecision =
  | { readonly outcome: 'ACCEPT'; readonly state: 'ACCEPTED' }
  | { readonly outcome: 'ALREADY_ACCEPTED'; readonly state: 'ACCEPTED' }
  | { readonly outcome: 'INSUFFICIENT_QUANTITY'; readonly state: 'PENDING' }
  | { readonly outcome: 'NOT_RECEIVER'; readonly state: OfferState }
  | { readonly outcome: 'NOT_PENDING'; readonly state: OfferState };

// One acceptance by the receiver completes the offer for every kind (A8).
// A repeat accept of an ACCEPTED offer is idempotent. Not enough quantity keeps PENDING (A9).
export function decideAccept(input: {
  readonly state: OfferState;
  readonly actorOrgId: string;
  readonly receiverOrgId: string;
  readonly quantitySufficient: boolean;
}): AcceptDecision {
  const { state } = input;
  if (input.actorOrgId !== input.receiverOrgId) return { outcome: 'NOT_RECEIVER', state };
  if (state === 'ACCEPTED') return { outcome: 'ALREADY_ACCEPTED', state: 'ACCEPTED' };
  if (state !== 'PENDING') return { outcome: 'NOT_PENDING', state };
  if (!input.quantitySufficient) return { outcome: 'INSUFFICIENT_QUANTITY', state: 'PENDING' };
  return { outcome: 'ACCEPT', state: 'ACCEPTED' };
}
