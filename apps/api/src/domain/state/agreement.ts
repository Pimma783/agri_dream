// Agreement state machine (Requirements 12.10, 13.4, 14.13). PURCHASE_CONFIRMED and SERVICE_CONFIRMED
// are the happy-path end. There is no DELIVERED, PAID or COMPLETED state (Requirement 19.4).
import { makeNext, type TransitionTable } from './table.js';

export const AGREEMENT_KINDS = ['PURCHASE', 'BALING_SERVICE'] as const;
export type AgreementKind = (typeof AGREEMENT_KINDS)[number];

export const AGREEMENT_STATES = ['PURCHASE_CONFIRMED', 'SERVICE_CONFIRMED', 'NEEDS_REVIEW', 'CANCELLED'] as const;
export type AgreementState = (typeof AGREEMENT_STATES)[number];

export const AGREEMENT_EVENTS = ['CANCEL', 'SOURCE_CANCELLED', 'KEEP'] as const;
export type AgreementEvent = (typeof AGREEMENT_EVENTS)[number];

export const AGREEMENT_TABLE: TransitionTable<AgreementState, AgreementEvent> = {
  PURCHASE_CONFIRMED: { CANCEL: 'CANCELLED', SOURCE_CANCELLED: 'NEEDS_REVIEW' },
  SERVICE_CONFIRMED: { CANCEL: 'CANCELLED' },
  NEEDS_REVIEW: { CANCEL: 'CANCELLED', KEEP: 'PURCHASE_CONFIRMED' },
  CANCELLED: {},
};

export const next = makeNext('agreement', AGREEMENT_TABLE);

export function initialAgreementState(kind: AgreementKind): AgreementState {
  return kind === 'PURCHASE' ? 'PURCHASE_CONFIRMED' : 'SERVICE_CONFIRMED';
}
