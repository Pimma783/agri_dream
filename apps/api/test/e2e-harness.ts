// Shared harness for the end-to-end story tests (task 14.2). Synthetic data only; no network, no real LINE or AWS.
//   Farmer  : signed LINE webhook requests -> createApp -> stored event + line_event job -> JobRunner -> gateway -> farmer handler.
//             Replies and offer pushes leave through notification_outbox and are delivered by OutboxSender to a FakeLineClient.
//   Others  : the Dashboard over HTTP with the session cookie and CSRF token (baler, factory).
//   Model   : MockBedrock scripts only (the assistant never reaches AWS).
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import type { BedrockPort, ConverseRequest } from '../src/adapters/bedrock/port.js';
import { MockBedrock, type MockStep } from '../src/adapters/bedrock/test-support.js';
import { composeAssistant } from '../src/assistant/index.js';
import { createBalerHandler, createFactoryHandler, createFarmerHandler, createLineGateway } from '../src/channels/index.js';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { mountAgreementRoutes } from '../src/http/agreement-routes.js';
import { mountMatchRoutes } from '../src/http/match-routes.js';
import { mountOfferRoutes } from '../src/http/offer-routes.js';
import { mountResourceRoutes } from '../src/http/resource-routes.js';
import { HandlerRegistry, JobRunner, OutboxSender, registerLineEvent } from '../src/jobs/index.js';
import { registerRecomputeMatches } from '../src/jobs/recompute-matches.js';
import { createLogger } from '../src/logger.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import {
  createConversationService, createDraftService, createJobQueue, createLineEventStore, createMatchReadService, createMatchingService,
  createOfferService, createOutboxQueue, createWebhookService,
} from '../src/services/index.js';
import { createLineIdentityService } from '../src/services/identity/index.js';
import { createTestDb, type TestDb } from './db-helper.js';
import { channels, post, sign } from './webhook-helper.js';

export const ORIGIN = 'http://localhost:3000';
export const PW = 'synthetic-Passw0rd-for-tests';

export interface Session { cookie: string; csrf: string; orgId: string; userId: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Json { status: number; body: any }
export type Delivered = { messages: ReadonlyArray<Record<string, any>> } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Forwards to the MockBedrock of the moment, so a test can script one model turn at a time. */
class ScriptedModel implements BedrockPort {
  readonly kind = 'mock' as const;
  mock = new MockBedrock([]);
  converse(req: ConverseRequest, signal: AbortSignal) { return this.mock.converse(req, signal); }
}

export interface E2e {
  db: TestDb;
  base: string;
  line: FakeLineClient;
  model: ScriptedModel;
  /** Script the next model turns (the last step repeats when the script runs out). */
  script(...steps: MockStep[]): void;
  /** Run the line_event, recompute_matches and other registered jobs until none is due. */
  runJobs(): Promise<void>;
  /** Run two job runners at once, one job each: two LINE events processed at the same time. */
  runJobsConcurrently(): Promise<void>;
  /** Deliver queued outbox rows to the FakeLineClient. */
  flushOutbox(): Promise<void>;
  farmer(lineUserId: string): FarmerLine;
  loginAs(kind: 'BALER' | 'BUYER_FACTORY' | 'FARMER', orgName?: string): Promise<Session>;
  call(s: Session | null, method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Json>;
  count(sql: string, params?: unknown[]): Promise<number>;
  close(): Promise<void>;
}

export interface FarmerLine {
  readonly userId: string;
  /** POST one signed webhook request with one event. Returns the HTTP status and the event id. */
  send(event: Record<string, unknown>, eventId?: string): Promise<{ status: number; eventId: string; raw: string }>;
  /** Re-POST an identical body and signature. */
  resend(raw: string): Promise<number>;
  follow(): Promise<void>;
  /** Send, run jobs, flush the outbox. Returns the messages LINE delivered for this event. */
  say(event: Record<string, unknown>): Promise<Delivered['messages']>;
  text(text: string): Promise<Delivered['messages']>;
  location(lat: number, lng: number): Promise<Delivered['messages']>;
  postback(data: string): Promise<Delivered['messages']>;
  /** Postback `data` of a quick-reply button in a delivered message, by label. */
  button(messages: Delivered['messages'], label: string): string;
  /** Every message LINE delivered to this farmer, oldest first. */
  inbox(): Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  org(): Promise<{ org_id: string; user_id: string }>;
}

export async function createE2e(): Promise<E2e> {
  const db = await createTestDb({ max: 12 });
  const pool = db.pool;
  const auth = createAuthService({
    pool, config: { idleMs: 3_600_000, absoluteMs: 18_000_000 }, limiter: new LoginRateLimiter({ maxAttempts: 1000, windowMs: 60_000 }),
  });
  const env = EnvSchema.parse({ NODE_ENV: 'test', WEB_ORIGIN: ORIGIN });
  const app = createApp({
    env, logger: createLogger('silent'), auth, webhooks: { channels, service: createWebhookService({ pool }) },
    mountRoutes: (a) => {
      const ctx = { pool };
      mountResourceRoutes(a, ctx); mountMatchRoutes(a, ctx); mountOfferRoutes(a, ctx); mountAgreementRoutes(a, ctx);
    },
  });
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The same wiring as worker.ts, with the fake LINE client and the scripted model.
  const line = new FakeLineClient();
  const model = new ScriptedModel();
  const drafts = createDraftService({ pool });
  const conversations = createConversationService({ pool });
  const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
  const gateway = createLineGateway({
    events: createLineEventStore({ pool }),
    line,
    handlers: {
      farmer: createFarmerHandler({
        identity, drafts, conversations, offers: createOfferService({ pool }),
        assistant: composeAssistant({
          env: { ENABLE_REAL_BEDROCK: true, BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-5', ASSISTANT_HISTORY_MESSAGES: 12, AI_MODE: 'enabled' },
          drafts, conversations, matches: createMatchReadService({ pool }), bedrock: model,
        }),
      }),
      baler: createBalerHandler({ identity, offers: createOfferService({ pool }), matches: createMatchReadService({ pool }), webOrigin: 'http://localhost:3000' }),
      factory: createFactoryHandler({ identity, offers: createOfferService({ pool }), matches: createMatchReadService({ pool }), webOrigin: 'http://localhost:3000' }),
    },
  });
  const handlers = new HandlerRegistry();
  registerLineEvent(handlers, { gateway });
  registerRecomputeMatches(handlers, { matching: createMatchingService({ pool }) });
  const runner = (batchSize: number) => new JobRunner({ queue: createJobQueue(pool), handlers, batchSize });
  const sender = new OutboxSender({ queue: createOutboxQueue(pool), line, batchSize: 200 });

  const runJobs = async () => {
    for (let i = 0; i < 20; i += 1) if ((await runner(200).tick()).claimed === 0) return;
    throw new Error('jobs did not settle');
  };
  const flushOutbox = async () => {
    for (let i = 0; i < 10; i += 1) if ((await sender.tick()).claimed === 0) return;
    throw new Error('outbox did not settle');
  };

  let seq = 0;
  const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);

  async function call(s: Session | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Json> {
    const headers: Record<string, string> = { ...extra };
    if (s) headers.cookie = s.cookie;
    if (s && method !== 'GET') { headers.origin = ORIGIN; headers['x-csrf-token'] = s.csrf; }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function loginAs(kind: 'BALER' | 'BUYER_FACTORY' | 'FARMER', orgName = `synthetic-e2e-org-${seq + 1}`): Promise<Session> {
    const email = `e2e-${++seq}-${Date.now()}@example.invalid`;
    const { org, user } = await createDemoOrgUser(pool, { kind, orgName, email, password: PW });
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }),
    });
    expect(res.status).toBe(204);
    const cookie = `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
    const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
    return { cookie, csrf: me.csrf_secret, orgId: org.id, userId: user.id };
  }

  function farmer(userId: string): FarmerLine {
    const mine = () => line.delivered.filter((p) => p.channel === 'farmer' && p.to === userId);
    const self: FarmerLine = {
      userId,
      async send(event, eventId = `evt-${Date.now()}-${++seq}`) {
        const raw = JSON.stringify({
          destination: 'U-synthetic-destination',
          events: [{ webhookEventId: eventId, timestamp: Date.now(), source: { type: 'user', userId }, ...event }],
        });
        const res = await post(base, 'farmer', raw, sign('farmer', raw));
        return { status: res.status, eventId, raw };
      },
      async resend(raw) { return (await post(base, 'farmer', raw, sign('farmer', raw))).status; },
      async follow() { expect((await self.send({ type: 'follow' })).status).toBe(200); await runJobs(); await flushOutbox(); },
      async say(event) {
        const before = mine().length;
        const sent = await self.send(event);
        expect(sent.status).toBe(200);
        await runJobs();
        await flushOutbox();
        return mine().slice(before).flatMap((p) => p.messages);
      },
      text: (t) => self.say({ type: 'message', message: { type: 'text', id: `m-${++seq}`, text: t } }),
      location: (lat, lng) => self.say({ type: 'message', message: { type: 'location', id: `m-${++seq}`, latitude: lat, longitude: lng } }),
      postback: (data) => self.say({ type: 'postback', postback: { data } }),
      button(messages, label) {
        for (const m of messages) {
          for (const item of m.quickReply?.items ?? []) if (item.action.type === 'postback' && item.action.label === label) return item.action.data as string;
        }
        throw new Error(`no postback button "${label}" in the delivered messages`);
      },
      inbox: () => mine().flatMap((p) => p.messages),
      async org() {
        const r = await pool.query<{ org_id: string; user_id: string }>(
          `SELECT org_id, user_id FROM line_identities WHERE channel = 'farmer' AND line_user_id = $1`, [userId]);
        return r.rows[0]!;
      },
    };
    return self;
  }

  return {
    db, base, line, model,
    script: (...steps) => { model.mock = new MockBedrock(steps); },
    runJobs,
    async runJobsConcurrently() {
      // Each runner takes one job (FOR UPDATE SKIP LOCKED), so two events are handled at the same time.
      await Promise.all([runner(1).tick(), runner(1).tick()]);
    },
    flushOutbox, farmer, loginAs, call, count,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await db.close();
    },
  };
}

/** A fixed model turn for the assistant: a draft patch plus the Thai reply text. */
export const turn = (kind: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}): MockStep => ({
  type: 'json', value: { intent: kind === 'BALING_REQUEST' ? 'FIND_BALER' : 'SELL_MATERIAL', reply_text: 'รับทราบ', draft_patch: { kind, fields }, ...extra },
});

/** All text LINE delivered in one step. An accept also queues the "accepted" push, so a reply is not always first. */
export const allText = (messages: ReadonlyArray<Record<string, unknown>>): string => messages.map((m) => String(m.text)).join('\n---\n');
