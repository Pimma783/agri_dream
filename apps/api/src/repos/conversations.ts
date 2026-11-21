import { z } from 'zod';
import { type Db, many, maybe, ts, uuid } from './db.js';
import { type Insertable, table } from './table.js';
export const ConversationRow = z.object({
  id: uuid,
  line_identity_id: uuid.nullable(),
  user_id: uuid.nullable(),
  org_id: uuid.nullable(),
  channel: z.enum(['farmer', 'baler', 'factory', 'web']),
  active_draft_id: uuid.nullable(),
  is_demo: z.boolean(),
  created_at: ts,
});
export type Conversation = z.infer<typeof ConversationRow>;
const c = table('conversations', ConversationRow);
export const conversations = {
  insert: (db: Db, v: Insertable<Conversation, 'channel'>) => c.insert(db, v),
  get: c.get,
  getForUpdate: c.getForUpdate,
  /** Newest conversation for a LINE identity, or null. */
  latestByLineIdentity: (db: Db, lineIdentityId: string) =>
    maybe(db, ConversationRow, 'SELECT * FROM conversations WHERE line_identity_id = $1 ORDER BY created_at DESC, id LIMIT 1', [lineIdentityId]),
  latestByUser: (db: Db, userId: string) =>
    maybe(db, ConversationRow, 'SELECT * FROM conversations WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT 1', [userId]),
  setActiveDraft: (db: Db, id: string, draftId: string | null) => c.update(db, id, { active_draft_id: draftId }),
};
export const MessageRow = z.object({
  id: uuid,
  conversation_id: uuid,
  direction: z.enum(['IN', 'OUT']),
  text: z.string().nullable(),
  source_event_id: z.string().nullable(),
  created_at: ts,
});
export type Message = z.infer<typeof MessageRow>;
const m = table('messages', MessageRow);
export const messages = {
  /** Returns null when source_event_id was already stored (duplicate delivery). */
  append: (db: Db, v: Insertable<Message, 'conversation_id' | 'direction'>) =>
    v.source_event_id ? m.insertIfAbsent(db, v, 'source_event_id') : m.insert(db, v),
  /** Latest `limit` messages, returned oldest first. */
  recent: async (db: Db, conversationId: string, limit = 20) =>
    (
      await many(
        db,
        MessageRow,
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
        [conversationId, limit],
      )
    ).reverse(),
};
