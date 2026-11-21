// Farmer image path (task 13.3, Requirements 8.1, 8.6, 8.8).
// A farmer's image is downloaded through the farmer channel client only, stored through the assessment service
// (owner check, size, magic bytes, one queued assess_image job per media id), and acknowledged in Thai with the
// fixed disclaimer. Nothing here blocks publishing: every failure is a polite message and the listing flow goes on.
// Image bytes, message ids and tokens are never logged.
import type { LineContentResult } from '../../../adapters/line/index.js';
import type { Actor } from '../../../domain/permissions.js';
import {
  ASSESSMENT_DISCLAIMER_TH, MediaServiceError, type AssessmentService, type ConversationService, type DraftService,
} from '../../../services/index.js';
import { textMessage, textQuickReplies } from '../messages.js';
import type { LineEventContext } from './types.js';

export const FARMER_IMAGE_TEXT = {
  received: `ได้รับรูปแล้ว กำลังประเมินเบื้องต้น\n${ASSESSMENT_DISCLAIMER_TH}\nยังเผยแพร่รายการได้ตามปกติ`,
  needDraft: 'ยังไม่มีรายการที่กำลังทำอยู่ กรุณาเริ่มลงขายวัสดุก่อน แล้วส่งรูปอีกครั้ง',
  tooLarge: 'รูปมีขนาดใหญ่เกินไป กรุณาส่งรูปที่เล็กกว่า 5 MB รายการของคุณยังทำต่อได้',
  wrongType: 'รับเฉพาะรูป JPG หรือ PNG เท่านั้น รายการของคุณยังทำต่อได้',
  failed: 'ดาวน์โหลดรูปไม่สำเร็จ กรุณาลองส่งใหม่ รายการของคุณยังทำต่อได้',
} as const;

export interface FarmerImageDeps {
  /** Downloads image content with the farmer channel's own token (the farmer channel client's getContent). */
  getContent: (messageId: string) => Promise<LineContentResult>;
  assessment: Pick<AssessmentService, 'upload'>;
  drafts: Pick<DraftService, 'get'>;
  conversations: Pick<ConversationService, 'open'>;
}

const OPEN_DRAFT = new Set(['DRAFT', 'AWAITING_REVIEW']);
const say = (text: string, buttons: readonly string[] = []) => textMessage(text, textQuickReplies(buttons));

/** Returns the `onImage` hook for the farmer handler. Always returns true: the image event is fully handled here. */
export function createFarmerImageHook(deps: FarmerImageDeps): (ctx: LineEventContext, actor: Actor) => Promise<boolean> {
  return async (ctx, actor) => {
    const e = ctx.event;
    if (e.kind !== 'image') return false;
    const opened = await deps.conversations.open(actor);
    const draftId = opened.ok ? opened.value.active_draft_id : null;
    const current = draftId ? await deps.drafts.get(actor, draftId) : null;
    if (!current || !current.ok || !OPEN_DRAFT.has(current.value.draft.status)) {
      await ctx.reply([say(FARMER_IMAGE_TEXT.needDraft, ['ลงขายวัสดุ'])]);
      return true;
    }
    if (!e.messageId) {
      await ctx.reply([say(FARMER_IMAGE_TEXT.failed)]);
      return true;
    }
    let content: LineContentResult;
    try {
      content = await deps.getContent(e.messageId);
    } catch {
      content = { ok: false, code: 'NETWORK' };
    }
    if (!content.ok) {
      await ctx.reply([say(content.code === 'TOO_LARGE' ? FARMER_IMAGE_TEXT.tooLarge : FARMER_IMAGE_TEXT.failed)]);
      return true;
    }
    try {
      // The same bytes for the same draft return the existing media id and the job is deduplicated by media id,
      // so a replayed webhook event or a re-sent message stores one row and queues one job.
      await deps.assessment.upload(actor, { ownerType: 'DRAFT', ownerId: current.value.draft.id, bytes: content.bytes });
    } catch (err) {
      if (err instanceof MediaServiceError) {
        const text =
          err.code === 'TOO_LARGE' ? FARMER_IMAGE_TEXT.tooLarge
          : err.code === 'UNSUPPORTED_TYPE' || err.code === 'EMPTY' ? FARMER_IMAGE_TEXT.wrongType
          : FARMER_IMAGE_TEXT.failed;
        await ctx.reply([say(text)]);
        return true;
      }
      await ctx.reply([say(FARMER_IMAGE_TEXT.failed)]);
      return true;
    }
    await ctx.reply([say(FARMER_IMAGE_TEXT.received, ['แก้ไข', 'เก็บร่าง'])]);
    return true;
  };
}
