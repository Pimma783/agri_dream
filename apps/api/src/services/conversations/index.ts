// Layer: services. Conversations and messages for the assistant (Requirement 4). A conversation belongs to one
// user in one organization; any other actor sees it as NOT_FOUND. The assistant calls this service, never repos.
import { z } from 'zod';
import type { Actor, Channel } from '../../domain/permissions.js';
import { conversations, drafts, type Conversation, type Message, messages } from '../../repos/index.js';
import { authorized, registerService, type ServiceContext } from '../context.js';
import { appError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

registerService('conversations', 'CHAT_ASSISTANT');

export type { Conversation, Message };

const CHANNEL_OF: Readonly<Record<Channel, Conversation['channel']>> = {
  'line:farmer': 'farmer',
  'line:baler': 'baler',
  'line:factory': 'factory',
  web: 'web',
  assistant: 'web',
};

const IdSchema = z.uuid();
const TextSchema = z.string().min(1).max(4000);
const EventIdSchema = z.string().min(1).max(200);

export interface ConversationService {
  /** The actor's latest conversation on this channel, or a new one. */
  open(actor: Actor): Promise<Result<Conversation>>;
  /** Stores a message. Returns null when `sourceEventId` was already stored (duplicate delivery). */
  append(
    actor: Actor,
    input: { conversationId: string; direction: 'IN' | 'OUT'; text: string; sourceEventId?: string },
  ): Promise<Result<Message | null>>;
  /** Latest `limit` messages, oldest first. */
  recent(actor: Actor, conversationId: string, limit: number): Promise<Result<Message[]>>;
  /** Point the conversation at one of the actor's own drafts, or clear it with null. */
  setActiveDraft(actor: Actor, conversationId: string, draftId: string | null): Promise<Result<Conversation>>;
  get(actor: Actor, conversationId: string): Promise<Result<Conversation>>;
}

export function createConversationService(ctx: ServiceContext): ConversationService {
  async function owned(actor: Actor, id: string): Promise<Conversation | null> {
    if (!IdSchema.safeParse(id).success) return null;
    const row = await conversations.get(ctx.pool, id);
    return row && row.org_id === actor.orgId && row.user_id === actor.userId ? row : null;
  }
  const guard = <T>(actor: Actor, fn: () => Promise<Result<T>>) => authorized(ctx, actor, 'CHAT_ASSISTANT', undefined, fn);

  return {
    open: (actor) =>
      guard(actor, async () => {
        const channel = CHANNEL_OF[actor.channel];
        const latest = await conversations.latestByUser(ctx.pool, actor.userId);
        if (latest && latest.org_id === actor.orgId && latest.channel === channel) return ok(latest);
        return ok(await conversations.insert(ctx.pool, { channel, user_id: actor.userId, org_id: actor.orgId }));
      }),

    get: (actor, id) =>
      guard(actor, async () => {
        const row = await owned(actor, id);
        return row ? ok(row) : err(appError('NOT_FOUND'));
      }),

    append: (actor, input) =>
      guard(actor, async () => {
        const text = TextSchema.safeParse(input?.text);
        if (!text.success) return err(appError('VALIDATION', { fields: [{ path: 'text', message: 'INVALID_VALUE' }] }));
        if (input.sourceEventId !== undefined && !EventIdSchema.safeParse(input.sourceEventId).success) {
          return err(appError('VALIDATION', { fields: [{ path: 'sourceEventId', message: 'INVALID_VALUE' }] }));
        }
        if (!(await owned(actor, input.conversationId))) return err(appError('NOT_FOUND'));
        const row = await messages.append(ctx.pool, {
          conversation_id: input.conversationId,
          direction: input.direction,
          text: text.data,
          source_event_id: input.sourceEventId ?? null,
        });
        return ok(row);
      }),

    recent: (actor, id, limit) =>
      guard(actor, async () => {
        if (!(await owned(actor, id))) return err(appError('NOT_FOUND'));
        const n = Math.max(0, Math.min(100, Math.trunc(limit)));
        return ok(n === 0 ? [] : await messages.recent(ctx.pool, id, n));
      }),

    setActiveDraft: (actor, id, draftId) =>
      guard(actor, async () => {
        if (!(await owned(actor, id))) return err(appError('NOT_FOUND'));
        if (draftId !== null) {
          const d = IdSchema.safeParse(draftId).success ? await drafts.get(ctx.pool, draftId) : null;
          if (!d || d.org_id !== actor.orgId) return err(appError('NOT_FOUND'));
        }
        const row = await conversations.setActiveDraft(ctx.pool, id, draftId);
        return row ? ok(row) : err(appError('NOT_FOUND'));
      }),
  };
}
