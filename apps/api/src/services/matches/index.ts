// Layer: services. Read-only match listing for the actor's own side (Requirements 9.10, 10.7, 14.9, 17.5).
// Authorization: PUBLISHED_VIEW_READ on the actor's own organization. The counterparty is shown through the
// allowlist mapper in visibility.ts, so contact data, exact private addresses and farmer identity never leave here.
import { z } from 'zod';
import {
  balingRequests, balingServices, demands, listings, matches, organizations, type Db, type OwnMatch,
} from '../../repos/index.js';
import { authorized, registerService, type ServiceContext } from '../context.js';
import { appError } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import { type CounterpartySource, type MatchView, toMatchView } from './visibility.js';

registerService('matches', 'PUBLISHED_VIEW_READ');

export { toMatchView, SCORE_LABEL_TH, WEIGHTS_LABEL_TH, DISTANCE_LABEL_TH } from './visibility.js';
export type { CounterpartySource, MatchView, OwnSide, MatchEntityKind } from './visibility.js';

export const DEFAULT_MATCH_LIMIT = 50;
export const MAX_MATCH_LIMIT = 100;

const QuerySchema = z
  .object({
    entity_id: z.uuid().optional(),
    route: z.coerce.number().int().min(1).max(4).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_MATCH_LIMIT).default(DEFAULT_MATCH_LIMIT),
  })
  .strict();
export type ListMatchesQuery = z.input<typeof QuerySchema>;

export interface MatchReadService {
  /** Matches where the actor's organization owns one side, ordered by tier then score. */
  list(actor: import('../../domain/permissions.js').Actor, query?: ListMatchesQuery): Promise<Result<MatchView[]>>;
}

export function createMatchReadService(ctx: ServiceContext): MatchReadService {
  async function counterparty(db: Db, m: OwnMatch): Promise<CounterpartySource | null> {
    // The counterparty is the entity on the side the actor does not own.
    const cpId = m.own_side === 'supply' ? m.demand_id : m.supply_id;
    if (m.route === 3) {
      if (m.own_side === 'supply') {
        const row = await balingServices.get(db, cpId);
        const org = row ? await organizations.get(db, row.org_id) : null;
        return row && org ? { type: 'BALING_SERVICE', row, org } : null;
      }
      const row = await balingRequests.get(db, cpId);
      const org = row ? await organizations.get(db, row.org_id) : null;
      return row && org ? { type: 'BALING_REQUEST', row, org } : null;
    }
    if (m.own_side === 'supply') {
      const row = await demands.get(db, cpId);
      const org = row ? await organizations.get(db, row.org_id) : null;
      return row && org ? { type: 'DEMAND', row, org } : null;
    }
    const row = await listings.get(db, cpId);
    const org = row ? await organizations.get(db, row.org_id) : null;
    return row && org ? { type: 'LISTING', row, org } : null;
  }

  return {
    async list(actor, query = {}) {
      return authorized(ctx, actor, 'PUBLISHED_VIEW_READ', { orgId: actor.orgId }, async () => {
        const parsed = QuerySchema.safeParse(query);
        if (!parsed.success) {
          return err(appError('VALIDATION', { fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }));
        }
        const q = parsed.data;
        const rows = await matches.listForOrg(ctx.pool, actor.orgId, {
          limit: q.limit,
          ...(q.entity_id ? { entityId: q.entity_id } : {}),
          ...(q.route ? { route: q.route } : {}),
        });
        const out: MatchView[] = [];
        for (const m of rows) {
          const cp = await counterparty(ctx.pool, m);
          if (cp) out.push(toMatchView(m, m.own_side, cp));
        }
        return ok(out);
      });
    },
  };
}
