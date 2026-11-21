// Layer: services. Baling services (BALER) and baling requests (FARMER): read, pause, open, close, cancel.
// Creation happens only by publishing a confirmed draft (services/drafts). Baling is kept apart from
// purchase demands in data and code (Requirement 7.5).
import { type BalingRequest, type BalingService, balingRequests, balingServices } from '../../repos/index.js';
import { createLifecycleService, type LifecycleService } from '../lifecycle.js';
import { registerService, type ServiceContext } from '../context.js';

registerService('baling_services', 'BALING_SERVICE_MANAGE');
registerService('baling_requests', 'BALING_REQUEST_SUBMIT');

export type BalingServiceService = LifecycleService<BalingService>;
export type BalingRequestService = LifecycleService<BalingRequest>;

export const createBalingServiceService = (ctx: ServiceContext): BalingServiceService =>
  createLifecycleService<BalingService>(ctx, {
    capability: 'BALING_SERVICE_MANAGE', repo: balingServices, auditType: 'baling_service', matchType: 'BALING_SERVICE',
  });

/** BALING_REQUEST_SUBMIT has no resource rule in the matrix, so the lifecycle checks ownership itself (NOT_FOUND). */
export const createBalingRequestService = (ctx: ServiceContext): BalingRequestService =>
  createLifecycleService<BalingRequest>(ctx, {
    capability: 'BALING_REQUEST_SUBMIT', repo: balingRequests, auditType: 'baling_request', matchType: 'BALING_REQUEST',
  });
