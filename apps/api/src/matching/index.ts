// Layer: matching (see design.md "Module boundaries"). Enforced by eslint.config.mjs.
export { filterPair, filterOnly, passingPairs } from './filter.js';
export type { FilterOutcome } from './filter.js';
export { scorePair, rankMatches, runMatching } from './score.js';
export { renderReasonTh, renderReasonsTh, renderFlagTh, WEIGHTS_DISCLAIMER_TH } from './explain.th.js';
