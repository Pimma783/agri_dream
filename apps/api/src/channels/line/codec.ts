// LINE postback codec (design.md "Postback codec", Requirements 2.4, 5.2, 11.9). Pure: no I/O.
// Wire format: `action=<action>&id=<id>[&v=<version>]`. Postback data is NOT authority: the service
// that handles the action still authorizes the actor. The allow-list below only decides which
// buttons a role may *be offered or may attempt*; it never replaces authorize().
import { z } from 'zod';
import type { Role } from '../../domain/permissions.js';

/** LINE limits postback `data` to 300 characters. */
export const POSTBACK_MAX_LENGTH = 300;

export const POSTBACK_ACTIONS = [
  'draft_confirm', // ยืนยันเผยแพร่
  'draft_edit', // แก้ไข
  'draft_keep', // เก็บร่าง
  'offer_send', // confirm sending a prepared offer
  'offer_accept',
  'offer_reject',
  'offer_withdraw',
  'agreement_view',
] as const;
export type PostbackAction = (typeof POSTBACK_ACTIONS)[number];

/** Static per-role allow-list (design.md: "Allowed actions per role are a static table"). */
export const ROLE_POSTBACK_ACTIONS: Readonly<Record<Role, readonly PostbackAction[]>> = {
  FARMER: ['draft_confirm', 'draft_edit', 'draft_keep', 'offer_send', 'offer_accept', 'offer_reject', 'offer_withdraw', 'agreement_view'],
  BALER: ['draft_confirm', 'draft_edit', 'draft_keep', 'offer_send', 'offer_accept', 'offer_reject', 'offer_withdraw', 'agreement_view'],
  BUYER_FACTORY: ['draft_confirm', 'draft_edit', 'draft_keep', 'offer_send', 'offer_accept', 'offer_reject', 'offer_withdraw', 'agreement_view'],
};

export function isPostbackActionAllowed(role: Role, action: PostbackAction): boolean {
  return ROLE_POSTBACK_ACTIONS[role].includes(action);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_PATTERN = /^(0|[1-9][0-9]{0,8})$/;

const PostbackSchema = z
  .object({
    action: z.enum(POSTBACK_ACTIONS),
    id: z.string().regex(ID_PATTERN),
    version: z.number().int().min(0).max(999_999_999).optional(),
  })
  .strict();

export type Postback = z.infer<typeof PostbackSchema>;

export type PostbackErrorCode = 'TOO_LONG' | 'MALFORMED' | 'UNKNOWN_ACTION' | 'INVALID_FIELD';
export type DecodeResult = { ok: true; value: Postback } | { ok: false; code: PostbackErrorCode };

/** Encodes a postback. Throws only for programmer errors (invalid input or over-long data). */
export function encodePostback(input: Postback): string {
  const parsed = PostbackSchema.parse(input);
  let data = `action=${parsed.action}&id=${parsed.id}`;
  if (parsed.version !== undefined) data += `&v=${parsed.version}`;
  if (data.length > POSTBACK_MAX_LENGTH) throw new RangeError('postback data exceeds LINE limit');
  return data;
}

/** Decodes untrusted postback data. Never throws; only the canonical encoding is accepted. */
export function decodePostback(data: unknown): DecodeResult {
  if (typeof data !== 'string') return { ok: false, code: 'MALFORMED' };
  if (data.length > POSTBACK_MAX_LENGTH) return { ok: false, code: 'TOO_LONG' };
  const parts = data.split('&');
  if (parts.length < 2 || parts.length > 3) return { ok: false, code: 'MALFORMED' };
  const [actionPart, idPart, versionPart] = parts as [string, string, string | undefined];
  if (!actionPart.startsWith('action=') || !idPart.startsWith('id=')) return { ok: false, code: 'MALFORMED' };
  if (versionPart !== undefined && !versionPart.startsWith('v=')) return { ok: false, code: 'MALFORMED' };
  const action = actionPart.slice('action='.length);
  const id = idPart.slice('id='.length);
  if (!(POSTBACK_ACTIONS as readonly string[]).includes(action)) return { ok: false, code: 'UNKNOWN_ACTION' };
  if (!ID_PATTERN.test(id)) return { ok: false, code: 'INVALID_FIELD' };
  let version: number | undefined;
  if (versionPart !== undefined) {
    const raw = versionPart.slice('v='.length);
    if (!VERSION_PATTERN.test(raw)) return { ok: false, code: 'INVALID_FIELD' };
    version = Number(raw);
  }
  const parsed = PostbackSchema.safeParse(version === undefined ? { action, id } : { action, id, version });
  if (!parsed.success) return { ok: false, code: 'INVALID_FIELD' };
  return { ok: true, value: parsed.data };
}
