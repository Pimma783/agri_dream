// MatchExplainPort backed by the match read service. The assistant explains matches from the backend's
// `reasons[]` and `flags[]` (never model text), and only for the actor's own side.
import type { Flag, Reason } from '../matching/types.js';
import type { MatchReadService } from '../services/matches/index.js';
import { ok, type Result } from '../services/index.js';
import type { MatchExplainItem, MatchExplainPort } from './tools.js';

const TITLE_TH: Readonly<Record<string, string>> = {
  LISTING: 'ผู้ขายวัสดุ',
  DEMAND: 'ผู้รับซื้อ',
  BALING_REQUEST: 'ผู้ขอใช้บริการอัดฟาง',
  BALING_SERVICE: 'ผู้ให้บริการอัดฟาง',
};

export function createMatchExplainPort(service: MatchReadService): MatchExplainPort {
  return {
    async listForActor(actor, limit): Promise<Result<MatchExplainItem[]>> {
      const r = await service.list(actor, { limit: Math.max(1, Math.min(limit, 100)) });
      if (!r.ok) return r;
      return ok(
        r.value.map((m): MatchExplainItem => ({
          id: m.id,
          title: m.counterparty.display_name ?? TITLE_TH[m.counterparty.entity_type] ?? 'คู่ที่เหมาะสม',
          tier: m.tier,
          reasons: m.reasons.map((x): Reason => ({ code: x.code as Reason['code'], params: x.params })),
          flags: m.flags.map((f): Flag => (f.code === 'NEEDS_CONFIRMATION' ? { code: f.code, field: f.field ?? '' } : ({ code: f.code } as Flag))),
        })),
      );
    },
  };
}
