// Draft and listing state machine (Requirement 5.7). Also used for resale listings.
// There is no DELIVERED, PAID or COMPLETED state (Requirement 19.4).
import { makeNext, type TransitionTable } from './table.js';

export const DRAFT_STATES = ['DRAFT', 'AWAITING_REVIEW', 'PUBLISHED', 'PAUSED', 'CLOSED', 'CANCELLED'] as const;
export type DraftState = (typeof DRAFT_STATES)[number];

export const DRAFT_EVENTS = ['COMPLETE', 'EDIT', 'PUBLISH', 'PAUSE', 'RESUME', 'CLOSE', 'CANCEL'] as const;
export type DraftEvent = (typeof DRAFT_EVENTS)[number];

export const DRAFT_INITIAL: DraftState = 'DRAFT';

export const DRAFT_TABLE: TransitionTable<DraftState, DraftEvent> = {
  DRAFT: { COMPLETE: 'AWAITING_REVIEW', EDIT: 'DRAFT', CANCEL: 'CANCELLED' },
  AWAITING_REVIEW: { EDIT: 'DRAFT', PUBLISH: 'PUBLISHED', CANCEL: 'CANCELLED' },
  PUBLISHED: { PAUSE: 'PAUSED', CLOSE: 'CLOSED', CANCEL: 'CANCELLED' },
  PAUSED: { RESUME: 'PUBLISHED', CANCEL: 'CANCELLED' },
  CLOSED: {},
  CANCELLED: {},
};

export const next = makeNext('draft', DRAFT_TABLE);
