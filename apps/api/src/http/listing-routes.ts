import type { Router } from 'express';
import type { ListingService } from '../services/index.js';
import { lifecycleRoutes } from './lifecycle-routes.js';

/** /listings: read and status changes. Listings are created only by publishing a draft. */
export const listingRoutes = (service: ListingService): Router => lifecycleRoutes('/listings', service);
