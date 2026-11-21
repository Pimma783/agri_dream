export {
  createLineIdentityService, generateLinkCode, normalizeLinkCode, lineChannelOf, roleOfLineChannel,
  LINK_CODE_ALPHABET, LINK_CODE_LENGTH, LINK_FAILURE_MESSAGE_TH, LINE_CHANNELS,
} from './service.js';
export type {
  LineChannel, LineLinkStatus, LinkFailure, LinkResult, IssuedLinkCode, FollowOutcome, LineIdentityService, LineIdentityDeps,
} from './service.js';
