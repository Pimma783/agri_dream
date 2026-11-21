// Task 9.8: pure/unit checks for event parsing, reply routing and the assistant preview rendering (no database).
import { describe, expect, it } from 'vitest';
import type { Assistant } from '../src/assistant/index.js';
import { createFarmerHandler, createLineGateway } from '../src/channels/index.js';
import { parseLineEvent } from '../src/channels/line/event.js';
import { decodePostback } from '../src/channels/line/codec.js';
import type { LineEventStore } from '../src/services/index.js';

describe('parseLineEvent', () => {
  const src = { source: { type: 'user', userId: 'U-synthetic' } };
  it('reads follow, text, location, image and postback', () => {
    expect(parseLineEvent({ type: 'follow', ...src }).kind).toBe('follow');
    expect(parseLineEvent({ type: 'message', ...src, message: { type: 'text', text: 'สวัสดี' } })).toMatchObject({ kind: 'text', text: 'สวัสดี' });
    expect(parseLineEvent({ type: 'message', ...src, message: { type: 'location', latitude: 1, longitude: 2 } }).kind).toBe('location');
    expect(parseLineEvent({ type: 'message', ...src, message: { type: 'image', id: '1' } }).kind).toBe('image');
    expect(parseLineEvent({ type: 'postback', ...src, postback: { data: 'x' } }).kind).toBe('postback');
  });
  it('ignores unknown and malformed events', () => {
    expect(parseLineEvent({ type: 'unfollow', ...src }).kind).toBe('ignored');
    expect(parseLineEvent({ type: 'message', message: { type: 'text', text: 'x' } }).kind).toBe('ignored');
    expect(parseLineEvent(null).kind).toBe('ignored');
  });
});

function fakeStore(payload: unknown, channel: 'farmer' | 'baler' | 'factory' = 'farmer') {
  const queued: Array<{ channel: string; lineUserId: string; dedupeKey: string }> = [];
  const store: LineEventStore = {
    get: async (id) => (id === 'missing' ? null : { id, channel, eventId: 'e', payload }),
    enqueuePush: async (i) => { queued.push({ channel: i.channel, lineUserId: i.lineUserId, dedupeKey: i.dedupeKey }); return true; },
  };
  return { store, queued };
}
const echo = (name: string) => async (ctx: { reply: (m: never[]) => Promise<void> }) => { void name; await ctx.reply([{ type: 'text', text: 'ok' }] as never[]); };

describe('createLineGateway reply routing', () => {
  const base = { type: 'message', source: { userId: 'U-synthetic' }, message: { type: 'text', text: 'x' } };
  const line = { kind: 'mock' as const, forChannel: () => ({ channel: 'farmer' as const, push: async () => ({ ok: true as const, duplicate: false }) }) };
  const handlers = { farmer: echo('f'), baler: echo('b'), factory: echo('c') } as never;

  it('reports an unknown event and ignores unsupported ones', async () => {
    const a = fakeStore(base);
    const g = createLineGateway({ events: a.store, line, handlers });
    expect(await g.process('missing')).toBe('event_not_found');
    const b = fakeStore({ type: 'unfollow', source: { userId: 'U' } });
    expect(await createLineGateway({ events: b.store, line, handlers }).process('1')).toBe('ignored');
  });

  it('uses the reply token when fresh, else pushes through the outbox on the event channel', async () => {
    const replies: unknown[] = [];
    const real = { kind: 'real' as const, forChannel: () => ({ channel: 'farmer' as const, push: async () => ({ ok: true as const, duplicate: false }), reply: async (i: unknown) => { replies.push(i); return { ok: true as const, duplicate: false }; } }) };
    const now = new Date('2030-01-01T00:00:10Z');
    const fresh = fakeStore({ ...base, replyToken: 'rt', timestamp: now.getTime() - 1000 });
    await createLineGateway({ events: fresh.store, line: real as never, handlers, now: () => now }).process('1');
    expect(replies).toHaveLength(1);
    expect(fresh.queued).toHaveLength(0);
    const old = fakeStore({ ...base, replyToken: 'rt', timestamp: now.getTime() - 120_000 });
    await createLineGateway({ events: old.store, line: real as never, handlers, now: () => now }).process('1');
    expect(replies).toHaveLength(1);
    expect(old.queued).toEqual([{ channel: 'farmer', lineUserId: 'U-synthetic', dedupeKey: 'line_event:1:0' }]);
  });

  it('falls back to the outbox when the reply call fails', async () => {
    const bad = { kind: 'real' as const, forChannel: () => ({ channel: 'farmer' as const, push: async () => ({ ok: true as const, duplicate: false }), reply: async () => ({ ok: false as const, code: 'INVALID_REQUEST' as const }) }) };
    const s = fakeStore({ ...base, replyToken: 'rt' });
    await createLineGateway({ events: s.store, line: bad as never, handlers }).process('1');
    expect(s.queued).toHaveLength(1);
  });

  it('routes by the stored channel, never another role', async () => {
    const s = fakeStore(base, 'baler');
    const seen: string[] = [];
    const h = { farmer: async () => { seen.push('farmer'); }, baler: async () => { seen.push('baler'); }, factory: async () => { seen.push('factory'); } } as never;
    await createLineGateway({ events: s.store, line, handlers: h }).process('1');
    expect(seen).toEqual(['baler']);
  });
});

describe('farmer handler draft preview', () => {
  it('renders a preview reply with confirm, edit and keep buttons carrying the draft version', async () => {
    const assistant: Assistant = {
      handle: async () => ({
        ok: true,
        value: {
          text: 'x', tool: 'degraded', confirmable: true, degraded: true, noWrite: false,
          draft: { id: 'd1', kind: 'SALE_LISTING', version: 4, status: 'AWAITING_REVIEW', complete: true, missing_fields: [] },
          preview: { kind: 'SALE_LISTING', title: 'ลงขายวัสดุ', rows: [{ label: 'ปริมาณ', value: '5 ตัน' }], actions: [] },
        },
      }),
    };
    const handler = createFarmerHandler({
      identity: { handleFollow: async () => { throw new Error('unused'); }, resolveLineActor: async () => ({ userId: 'u', orgId: 'o', role: 'FARMER', channel: 'line:farmer' }) },
      assistant, drafts: {} as never, conversations: {} as never, offers: {} as never,
    });
    const sent: Array<{ text: string; quickReply?: { items: Array<{ action: { data: string } }> } }> = [];
    await handler({
      channel: 'farmer', webhookEventId: 'w', event: { kind: 'text', lineUserId: 'U', text: 'x' },
      reply: async (m) => { sent.push(...(m as unknown as typeof sent)); },
    });
    const datas = sent[0]!.quickReply!.items.map((i) => decodePostback(i.action.data));
    expect(datas.map((d) => d.ok && d.value.action)).toEqual(['draft_confirm', 'draft_edit', 'draft_keep']);
    expect(datas.every((d) => d.ok && d.value.id === 'd1' && d.value.version === 4)).toBe(true);
    expect(sent[0]!.text).toContain('ปริมาณ: 5 ตัน');
  });
});
