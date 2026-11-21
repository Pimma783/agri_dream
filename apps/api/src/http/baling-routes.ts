import { Router } from 'express';
import type { BalingRequestService, BalingServiceService } from '../services/index.js';
import { lifecycleRoutes } from './lifecycle-routes.js';

/** /baling-services and /baling-requests: kept separate from purchase demands. */
export function balingRoutes(services: BalingServiceService, requests: BalingRequestService): Router {
  const r = Router();
  r.use(lifecycleRoutes('/baling-services', services));
  r.use(lifecycleRoutes('/baling-requests', requests));
  return r;
}
