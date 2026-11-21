import type { Router } from 'express';
import type { DemandService } from '../services/index.js';
import { lifecycleRoutes } from './lifecycle-routes.js';

/** /purchase-demands: read and status changes. Demands are created only by publishing a draft. */
export const demandRoutes = (service: DemandService): Router => lifecycleRoutes('/purchase-demands', service);
