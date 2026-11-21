// Layer: services. Published listings (sale and resale): read, pause, open, close, cancel.
// Creation happens only by publishing a confirmed draft (services/drafts).
import { type Listing, listings } from '../../repos/index.js';
import { createLifecycleService, type LifecycleService } from '../lifecycle.js';
import { registerService, type ServiceContext } from '../context.js';
import { D } from '../../domain/units.js';
import { releaseForListing } from '../resale/allocation.js';

registerService('listings', 'LISTING_MANAGE');

export type ListingService = LifecycleService<Listing>;

export const createListingService = (ctx: ServiceContext): ListingService =>
  createLifecycleService<Listing>(ctx, {
    capability: 'LISTING_MANAGE', repo: listings, auditType: 'listing', matchType: 'LISTING',
    // A10: a closed or cancelled resale listing keeps the sold quantity reserved and frees the unsold rest.
    onEnd: async (tx, _before, after) => {
      if (after.kind !== 'RESALE') return;
      await releaseForListing(tx, after.id, new D(after.total_qty_kg).minus(after.remaining_qty_kg).toFixed(3));
    },
  });
