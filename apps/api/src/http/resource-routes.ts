// One mount point for the resource route groups (drafts, listings, demands, baling).
import type { Express } from 'express';
import type { ServiceContext } from '../services/context.js';
import {
  createBalingRequestService, createBalingServiceService, createDemandService, createDraftService, createListingService,
} from '../services/index.js';
import { balingRoutes } from './baling-routes.js';
import { demandRoutes } from './demand-routes.js';
import { draftRoutes } from './draft-routes.js';
import { listingRoutes } from './listing-routes.js';

export function mountResourceRoutes(app: Express, ctx: ServiceContext): void {
  app.use(draftRoutes(createDraftService(ctx)));
  app.use(listingRoutes(createListingService(ctx)));
  app.use(demandRoutes(createDemandService(ctx)));
  app.use(balingRoutes(createBalingServiceService(ctx), createBalingRequestService(ctx)));
}
