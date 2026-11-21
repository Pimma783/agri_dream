import { z } from 'zod';
import { type Db, json, maybe, ts, uuid } from './db.js';
import { type Insertable, table } from './table.js';
export const ImageAssessmentRow = z.object({
  id: uuid,
  media_id: uuid,
  status: z.enum(['OK', 'UNASSESSABLE', 'UNAVAILABLE', 'FAILED']),
  result: json.nullable(),
  model_id: z.string().nullable(),
  error_code: z.string().nullable(),
  assessed_at: ts,
  is_demo: z.boolean(),
});
export type ImageAssessment = z.infer<typeof ImageAssessmentRow>;
const t = table('image_assessments', ImageAssessmentRow, { json: ['result'] });
export const imageAssessments = {
  /** One assessment per media row: a second save replaces the first. */
  upsert: (db: Db, v: Insertable<ImageAssessment, 'media_id' | 'status'>) =>
    maybe(
      db,
      ImageAssessmentRow,
      `INSERT INTO image_assessments (media_id, status, result, model_id, error_code, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (media_id) DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result,
         model_id = EXCLUDED.model_id, error_code = EXCLUDED.error_code, assessed_at = now()
       RETURNING *`,
      [v.media_id, v.status, v.result == null ? null : JSON.stringify(v.result), v.model_id ?? null, v.error_code ?? null, v.is_demo ?? false],
    ),
  get: t.get,
  getByMedia: async (db: Db, mediaId: string) => (await t.where(db, { media_id: mediaId }))[0] ?? null,
};
