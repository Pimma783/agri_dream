// Layer: services. Purchase demands of BALER and BUYER_FACTORY: read, pause, open, close, cancel.
// Creation happens only by publishing a confirmed draft (services/drafts).
import { type Demand, demands } from '../../repos/index.js';
import { createLifecycleService, type LifecycleService } from '../lifecycle.js';
import { registerService, type ServiceContext } from '../context.js';

registerService('demands', 'DEMAND_MANAGE');

export type DemandService = LifecycleService<Demand>;

export const createDemandService = (ctx: ServiceContext): DemandService =>
  createLifecycleService<Demand>(ctx, {
    capability: 'DEMAND_MANAGE', repo: demands, auditType: 'demand', matchType: 'DEMAND',
  });
