import express, { type Router } from 'express';
import { z } from 'zod';
import { verifySignature } from '../channels/line/signature.js';
import { LINE_CHANNEL_KEYS, type LineChannelConfig, type LineChannelKey } from '../config/line.js';
import type { WebhookService } from '../services/webhooks/index.js';
import { sendError } from './errors.js';
export interface WebhookDeps {
  channels: Partial<Record<LineChannelKey, LineChannelConfig>>;
  service: WebhookService;
}
const Body = z.object({
  destination: z.string().optional(),
  events: z.array(z.looseObject({ webhookEventId: z.string().min(1).max(128), type: z.string().min(1) })).max(1000),
});
/** Raw-body parser for /webhooks/line/*. Must be mounted before express.json so signatures see the exact bytes. */
export const webhookRawBody = express.raw({ type: () => true, limit: '1mb' });
export function webhookRoutes({ channels, service }: WebhookDeps): Router {
  const r = express.Router();
  for (const key of LINE_CHANNEL_KEYS) {
    r.post(`/webhooks/line/${key}`, async (req, res, next) => {
      try {
        const cfg = channels[key];
        if (!cfg) return sendError(res, 503, 'CHANNEL_NOT_CONFIGURED', 'ช่องทางนี้ยังไม่พร้อมใช้งาน');
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        // Signature first: a bad or missing one gets 401 before any parse, insert or body logging.
        if (!verifySignature(cfg.channelSecret, raw, req.get('x-line-signature'))) {
          return sendError(res, 401, 'INVALID_SIGNATURE', 'ลายเซ็นไม่ถูกต้อง');
        }
        let json: unknown;
        try {
          json = JSON.parse(raw.toString('utf8'));
        } catch {
          return sendError(res, 400, 'VALIDATION', 'ข้อมูลไม่ถูกต้อง');
        }
        const body = Body.safeParse(json);
        if (!body.success) return sendError(res, 400, 'VALIDATION', 'ข้อมูลไม่ถูกต้อง');
        await service.ingest(key, body.data.events as Parameters<WebhookService['ingest']>[1]);
        res.status(200).json({ ok: true });
      } catch (e) {
        next(e);
      }
    });
  }
  return r;
}
