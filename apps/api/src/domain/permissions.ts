// Pure permission layer (Requirement 1). Capability matrix from docs/AGRIMATCH_MVP_SPEC.md section 4.
// Only services/ may call authorize() (enforced by eslint.config.mjs).

export type Role = 'FARMER' | 'BALER' | 'BUYER_FACTORY';
export type Channel = 'line:farmer' | 'line:baler' | 'line:factory' | 'web' | 'assistant';

export interface Actor {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly channel: Channel;
}

export const ROLES: readonly Role[] = ['FARMER', 'BALER', 'BUYER_FACTORY'];

/** How a resource must relate to the actor's organization for a capability. */
export type AccessRule =
  | 'none' //              no resource involved (e.g. create in own org)
  | 'owner' //             resource.orgId === actor.orgId
  | 'receiver' //          resource.receiverOrgId === actor.orgId
  | 'owner_or_receiver' // owner or receiver
  | 'published_view'; //   resource.published and actor org is a matched party, or owner

export interface CapabilityRule {
  readonly roles: readonly Role[];
  readonly access: AccessRule;
}

const ALL: readonly Role[] = ROLES;

export const CAPABILITY_MATRIX = {
  CHAT_ASSISTANT: { roles: ALL, access: 'none' },
  LISTING_CREATE: { roles: ['FARMER', 'BALER'], access: 'none' },
  LISTING_MANAGE: { roles: ['FARMER', 'BALER'], access: 'owner' },
  DEMAND_CREATE: { roles: ['BALER', 'BUYER_FACTORY'], access: 'none' },
  DEMAND_MANAGE: { roles: ['BALER', 'BUYER_FACTORY'], access: 'owner' },
  BALING_SERVICE_PUBLISH: { roles: ['BALER'], access: 'none' },
  BALING_SERVICE_MANAGE: { roles: ['BALER'], access: 'owner' },
  BALING_SERVICE_SEARCH: { roles: ['FARMER'], access: 'none' },
  BALING_SERVICE_VIEW_OWN: { roles: ['BALER'], access: 'owner' },
  BALING_REQUEST_SUBMIT: { roles: ['FARMER'], access: 'none' },
  OFFER_SEND: { roles: ALL, access: 'none' },
  OFFER_READ: { roles: ALL, access: 'owner_or_receiver' },
  OFFER_RESPOND: { roles: ALL, access: 'receiver' },
  OFFER_WITHDRAW: { roles: ALL, access: 'owner' },
  PUBLISHED_VIEW_READ: { roles: ALL, access: 'published_view' },
  DASHBOARD_MANAGE: { roles: ['BALER', 'BUYER_FACTORY'], access: 'none' },
  RESALE_DRAFT_CREATE: { roles: ['BALER'], access: 'owner' },
} as const satisfies Record<string, CapabilityRule>;

export type Capability = keyof typeof CAPABILITY_MATRIX;
export const CAPABILITIES = Object.keys(CAPABILITY_MATRIX) as Capability[];

export interface Resource {
  /** Owning organization (sender for offers). */
  readonly orgId: string;
  /** Offer receiver organization. */
  readonly receiverOrgId?: string;
  /** True when the resource has a published counterparty view. */
  readonly published?: boolean;
  /** Organizations matched with this resource (they may read published fields). */
  readonly matchedOrgIds?: readonly string[];
}

export type AuthDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly status: 403; readonly code: 'FORBIDDEN' }
  | { readonly allowed: false; readonly status: 404; readonly code: 'NOT_FOUND' };

const ALLOW: AuthDecision = { allowed: true };
const FORBIDDEN: AuthDecision = { allowed: false, status: 403, code: 'FORBIDDEN' };
const NOT_FOUND: AuthDecision = { allowed: false, status: 404, code: 'NOT_FOUND' };

const CHANNEL_ROLE: Partial<Record<Channel, Role>> = {
  'line:farmer': 'FARMER',
  'line:baler': 'BALER',
  'line:factory': 'BUYER_FACTORY',
};

/** Role and org come from the verified session/channel, so this is a consistency check on the actor. */
function channelMatchesRole(actor: Actor): boolean {
  const required = CHANNEL_ROLE[actor.channel];
  return required === undefined || required === actor.role;
}

function resourceAllowed(rule: AccessRule, actor: Actor, resource: Resource): boolean {
  const owner = resource.orgId === actor.orgId;
  const receiver = resource.receiverOrgId !== undefined && resource.receiverOrgId === actor.orgId;
  switch (rule) {
    case 'none':
      return true;
    case 'owner':
      return owner;
    case 'receiver':
      return receiver;
    case 'owner_or_receiver':
      return owner || receiver;
    case 'published_view':
      return owner || (resource.published === true && (resource.matchedOrgIds ?? []).includes(actor.orgId));
  }
}

/**
 * Role violation (or role/channel mismatch) -> 403, regardless of the resource.
 * Role allowed but resource not reachable by this org -> 404, identical to a missing resource.
 */
export function authorize(actor: Actor, capability: Capability, resource?: Resource): AuthDecision {
  const rule: CapabilityRule | undefined = Object.hasOwn(CAPABILITY_MATRIX, capability)
    ? CAPABILITY_MATRIX[capability]
    : undefined;
  if (rule === undefined) return FORBIDDEN;
  if (!rule.roles.includes(actor.role) || !channelMatchesRole(actor)) return FORBIDDEN;
  if (rule.access === 'none') return ALLOW;
  if (resource === undefined) return NOT_FOUND;
  return resourceAllowed(rule.access, actor, resource) ? ALLOW : NOT_FOUND;
}

// ---- Service registry: every service declares the capability it enforces ----

export interface ServiceRegistry {
  register(serviceName: string, capability: Capability | undefined): void;
  entries(): ReadonlyMap<string, Capability | undefined>;
  /** Names of registered services without a valid declared capability. */
  undeclared(): string[];
}

export function createServiceRegistry(): ServiceRegistry {
  const map = new Map<string, Capability | undefined>();
  return {
    register(serviceName, capability) {
      map.set(serviceName, capability);
    },
    entries: () => map,
    undeclared: () =>
      [...map].filter(([, c]) => c === undefined || !Object.hasOwn(CAPABILITY_MATRIX, c)).map(([n]) => n),
  };
}

/** Process-wide registry that services register into at module load. */
export const serviceRegistry: ServiceRegistry = createServiceRegistry();
