// Resale listing state machine (Requirement 14.13). A resale listing uses the listing table,
// plus one extra event: the source agreement was cancelled, which pauses a published listing.
import { DRAFT_TABLE, type DraftEvent, type DraftState } from './draft.js';
import { makeNext, type TransitionTable } from './table.js';

export type ResaleState = DraftState;
export type ResaleEvent = DraftEvent | 'SOURCE_AGREEMENT_CANCELLED';

export const RESALE_TABLE: TransitionTable<ResaleState, ResaleEvent> = {
  DRAFT: { ...DRAFT_TABLE.DRAFT },
  AWAITING_REVIEW: { ...DRAFT_TABLE.AWAITING_REVIEW },
  PUBLISHED: { ...DRAFT_TABLE.PUBLISHED, SOURCE_AGREEMENT_CANCELLED: 'PAUSED' },
  PAUSED: { ...DRAFT_TABLE.PAUSED },
  CLOSED: {},
  CANCELLED: {},
};

export const next = makeNext('resale', RESALE_TABLE);
