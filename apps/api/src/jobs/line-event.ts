import { z } from 'zod';
import type { LineGateway } from '../channels/line/gateway.js';
import type { HandlerRegistry } from './registry.js';
import { PermanentJobError } from './types.js';

export const LINE_EVENT_JOB = 'line_event';
const Payload = z.object({ webhook_event_id: z.uuid() });

/** Registers the `line_event` handler: load the stored webhook event and run the per-role channel handler. */
export function registerLineEvent(handlers: HandlerRegistry, deps: { gateway: Pick<LineGateway, 'process'> }): HandlerRegistry {
  return handlers.register(LINE_EVENT_JOB, async (job) => {
    const p = Payload.safeParse(job.payload);
    if (!p.success) throw new PermanentJobError('BAD_PAYLOAD');
    const outcome = await deps.gateway.process(p.data.webhook_event_id);
    if (outcome === 'event_not_found') throw new PermanentJobError('EVENT_NOT_FOUND');
  });
}
