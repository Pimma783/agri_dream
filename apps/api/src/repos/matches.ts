import { z } from 'zod';
import { type Db, dec, exec, jsonAny, many, maybe, ts, uuid } from './db.js';
export const MatchRow = z.object({
  id: uuid,
  route: z.number().int().min(1).max(4),
  supply_id: uuid,
  demand_id: uuid,
  rule_version: z.string(),
  score: dec,
  weight_coverage: dec.nullable(),
  components: jsonAny,
  flags: jsonAny,
  reasons: jsonAny,
  distance_km: dec.nullable(),
  supply_version: z.number().int().nullable(),
  demand_version: z.number().int().nullable(),
  tier: z.number().int().min(0).max(1),
  is_demo: z.boolean(),
  computed_at: ts,
});
export type Match = z.infer<typeof MatchRow>;
export interface MatchInput {
  route: number;
  supply_id: string;
  demand_id: string;
  rule_version: string;
  score: string;
  weight_coverage?: string | null;
  components?: unknown;
  flags?: unknown;
  reasons?: unknown;
  distance_km?: string | null;
  supply_version?: number | null;
  demand_version?: number | null;
  tier: 0 | 1;
  is_demo?: boolean;
}
export const OwnMatchRow = MatchRow.extend({ own_side: z.enum(['supply', 'demand']) });
export type OwnMatch = z.infer<typeof OwnMatchRow>;

export const matches = {
  /**
   * Current matches in which `orgId` owns one side, with that side. Rows whose source entity is no longer
   * published, or whose stored source version differs from the current one (stale), are left out.
   * Order: tier, then score, then id. Route 3 pairs baling requests with baling services.
   */
  listForOrg: (db: Db, orgId: string, o: { entityId?: string; route?: number; limit: number }) =>
    many(
      db,
      OwnMatchRow,
      `SELECT m.*, CASE WHEN COALESCE(l.org_id, br.org_id) = $1 THEN 'supply' ELSE 'demand' END AS own_side
         FROM matches m
         LEFT JOIN material_listings l ON m.route <> 3 AND l.id = m.supply_id
         LEFT JOIN baling_requests br ON m.route = 3 AND br.id = m.supply_id
         LEFT JOIN purchase_demands d ON m.route <> 3 AND d.id = m.demand_id
         LEFT JOIN baling_services bs ON m.route = 3 AND bs.id = m.demand_id
        WHERE (COALESCE(l.org_id, br.org_id) = $1 OR COALESCE(d.org_id, bs.org_id) = $1)
          AND COALESCE(l.status, br.status) = 'PUBLISHED' AND COALESCE(d.status, bs.status) = 'PUBLISHED'
          AND (m.supply_version IS NULL OR m.supply_version = COALESCE(l.version, br.version))
          AND (m.demand_version IS NULL OR m.demand_version = COALESCE(d.version, bs.version))
          AND ($2::uuid IS NULL OR (COALESCE(l.org_id, br.org_id) = $1 AND m.supply_id = $2)
                                OR (COALESCE(d.org_id, bs.org_id) = $1 AND m.demand_id = $2))
          AND ($3::int IS NULL OR m.route = $3)
        ORDER BY m.tier ASC, m.score DESC, m.id ASC
        LIMIT $4`,
      [orgId, o.entityId ?? null, o.route ?? null, o.limit],
    ),
  /** Insert or refresh the stored result for (route, supply, demand, rule_version). */
  upsert: (db: Db, m: MatchInput) =>
    maybe(
      db,
      MatchRow,
      `INSERT INTO matches (route, supply_id, demand_id, rule_version, score, weight_coverage, components, flags, reasons,
         distance_km, supply_version, demand_version, tier, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (route, supply_id, demand_id, rule_version) DO UPDATE SET
         score = EXCLUDED.score, weight_coverage = EXCLUDED.weight_coverage, components = EXCLUDED.components,
         flags = EXCLUDED.flags, reasons = EXCLUDED.reasons, distance_km = EXCLUDED.distance_km,
         supply_version = EXCLUDED.supply_version, demand_version = EXCLUDED.demand_version,
         tier = EXCLUDED.tier, computed_at = now()
       RETURNING *`,
      [
        m.route, m.supply_id, m.demand_id, m.rule_version, m.score, m.weight_coverage ?? null,
        JSON.stringify(m.components ?? {}), JSON.stringify(m.flags ?? []), JSON.stringify(m.reasons ?? []),
        m.distance_km ?? null, m.supply_version ?? null, m.demand_version ?? null, m.tier, m.is_demo ?? false,
      ],
    ),
  /**
   * Delete the entity's rows in `routes` except those of `keepRuleVersion` whose counterparty is in `keepIds`.
   * `side` says whether the entity is the supply or the demand of the pair. Returns the number deleted.
   */
  deleteExcept: (
    db: Db,
    o: { side: 'supply' | 'demand'; entityId: string; routes: readonly number[]; keepRuleVersion: string; keepIds: readonly string[] },
  ) =>
    exec(
      db,
      `DELETE FROM matches
        WHERE ${o.side === 'supply' ? 'supply_id' : 'demand_id'} = $1 AND route = ANY($2::int[])
          AND NOT (rule_version = $3 AND ${o.side === 'supply' ? 'demand_id' : 'supply_id'} = ANY($4::uuid[]))`,
      [o.entityId, [...o.routes], o.keepRuleVersion, [...o.keepIds]],
    ),
  /** True when any stored result (any rule version) exists for the pair. */
  pairExists: async (db: Db, route: number, supplyId: string, demandId: string): Promise<boolean> =>
    ((await db.query('SELECT 1 FROM matches WHERE route = $1 AND supply_id = $2 AND demand_id = $3 LIMIT 1', [route, supplyId, demandId])).rowCount ?? 0) > 0,
  get: (db: Db, id: string) => maybe(db, MatchRow, 'SELECT * FROM matches WHERE id = $1', [id]),
  listBySupply: (db: Db, supplyId: string) =>
    many(db, MatchRow, 'SELECT * FROM matches WHERE supply_id = $1 ORDER BY score DESC, id', [supplyId]),
  listByDemand: (db: Db, demandId: string) =>
    many(db, MatchRow, 'SELECT * FROM matches WHERE demand_id = $1 ORDER BY score DESC, id', [demandId]),
};
