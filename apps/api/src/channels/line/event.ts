// Parsing of a stored LINE webhook event. The payload is untrusted: only the fields a handler needs are read, and
// message text is never logged. Pure: no I/O.
import { z } from 'zod';

const Source = z.object({ userId: z.string().min(1).max(128) });

const Follow = z.object({ type: z.literal('follow'), source: Source, replyToken: z.string().optional(), timestamp: z.number().optional() });
const Message = z.object({
  type: z.literal('message'),
  source: Source,
  replyToken: z.string().optional(),
  timestamp: z.number().optional(),
  message: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('location'), latitude: z.number().finite(), longitude: z.number().finite() }),
    z.object({ type: z.literal('image'), id: z.string().optional() }),
  ]).or(z.object({ type: z.string() })),
});
const Postback = z.object({
  type: z.literal('postback'),
  source: Source,
  replyToken: z.string().optional(),
  timestamp: z.number().optional(),
  postback: z.object({ data: z.string() }),
});

export type ParsedLineEvent =
  | { kind: 'follow'; lineUserId: string; replyToken?: string; timestamp?: number }
  | { kind: 'text'; lineUserId: string; text: string; replyToken?: string; timestamp?: number }
  | { kind: 'location'; lineUserId: string; latitude: number; longitude: number; replyToken?: string; timestamp?: number }
  | { kind: 'image'; lineUserId: string; messageId?: string; replyToken?: string; timestamp?: number }
  | { kind: 'postback'; lineUserId: string; data: string; replyToken?: string; timestamp?: number }
  | { kind: 'ignored' };

const meta = (e: { replyToken?: string | undefined; timestamp?: number | undefined }) => ({
  ...(e.replyToken ? { replyToken: e.replyToken } : {}),
  ...(e.timestamp !== undefined ? { timestamp: e.timestamp } : {}),
});

/** Unknown or malformed events become `ignored` (LINE sends many event types this product does not use). */
export function parseLineEvent(payload: unknown): ParsedLineEvent {
  const f = Follow.safeParse(payload);
  if (f.success) return { kind: 'follow', lineUserId: f.data.source.userId, ...meta(f.data) };
  const p = Postback.safeParse(payload);
  if (p.success) return { kind: 'postback', lineUserId: p.data.source.userId, data: p.data.postback.data, ...meta(p.data) };
  const m = Message.safeParse(payload);
  if (m.success) {
    const base = { lineUserId: m.data.source.userId, ...meta(m.data) };
    const msg = m.data.message as { type: string; text?: string; latitude?: number; longitude?: number; id?: string };
    if (msg.type === 'text' && typeof msg.text === 'string') return { kind: 'text', text: msg.text, ...base };
    if (msg.type === 'location' && typeof msg.latitude === 'number' && typeof msg.longitude === 'number') {
      return { kind: 'location', latitude: msg.latitude, longitude: msg.longitude, ...base };
    }
    if (msg.type === 'image') return { kind: 'image', ...(typeof msg.id === 'string' && msg.id ? { messageId: msg.id } : {}), ...base };
  }
  return { kind: 'ignored' };
}
