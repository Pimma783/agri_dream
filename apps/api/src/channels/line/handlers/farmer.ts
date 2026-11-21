// Farmer channel handler (task 9.8, Requirements 1.5, 2.6-2.8, 16.9; Requirements 4, 5, 6 through the services).
// A farmer lists, reviews and accepts offers entirely in LINE. Rules this file keeps:
//   - The actor comes only from the verified LINE user on this channel (identity.resolveLineActor / handleFollow).
//   - A postback is a request, never authority: the role allow-list only filters it, and the service still
//     authorizes the actor, checks ownership and the version.
//   - The assistant never publishes. Publishing happens here, on a postback button, with the version in the button.
//   - Message text, coordinates and tokens are never logged.
import { detectMenuIntent } from '../../../domain/menu-intents.js';
import type { Actor } from '../../../domain/permissions.js';
import { provinceLabelTh } from '../../../domain/step-parsers.js';
import {
  FARMER_MAIN_MENU, LOCATION_SHARED_TEXT, MATERIAL_LABEL, type Assistant, type AssistantReply,
} from '../../../assistant/index.js';
import {
  messageThOf, offerText, type AcceptResult, type BalingRequestService, type ConversationService, type DraftService,
  type ListingService, type OfferService, type Result,
} from '../../../services/index.js';
import type { LineIdentityService } from '../../../services/identity/index.js';
import { decodePostback, encodePostback, isPostbackActionAllowed } from '../codec.js';
import {
  AGREEMENT_NOTICE, buildDraftPreview, locationQuickReply, textMessage, textQuickReplies, type AnyQuickReplyItem, type TextMessage,
} from '../messages.js';
import type { LineChannelHandler, LineEventContext } from './types.js';

export const FARMER_MENU = FARMER_MAIN_MENU;

export const FARMER_TEXT = {
  greeting: 'สวัสดีครับ ยินดีต้อนรับสู่ AgriMatch\nบอกวัสดุที่ต้องการขาย เช่น ฟางข้าว ปริมาณ และจังหวัด ผมจะช่วยทำร่างให้ก่อน ยังไม่เผยแพร่จนกว่าคุณกดยืนยัน',
  /** AI off: no claim that the user can describe things freely. */
  greetingButtons: 'สวัสดีครับ ยินดีต้อนรับสู่ AgriMatch\nกดปุ่มด้านล่างเพื่อเริ่ม ระบบจะถามทีละข้อ ยังไม่เผยแพร่จนกว่าคุณกดยืนยัน',
  help: 'เมนูหลัก เลือกจากปุ่มด้านล่าง',
  helpDraft: 'ร่างที่กรอกค้างไว้ยังอยู่ กด «ลงขายวัสดุ» เพื่อกรอกต่อ หรือกด «ยกเลิก» เพื่อทิ้งร่าง',
  cancelled: 'ยกเลิกร่างแล้ว ยังไม่ได้เผยแพร่อะไร',
  noOpenDraft: 'ตอนนี้ไม่มีร่างที่กำลังกรอกอยู่',
  noListings: 'ยังไม่มีรายการ กดปุ่ม «ลงขายวัสดุ» เพื่อเริ่ม',
  noOffers: 'ไม่มีข้อเสนอที่รอตอบ',
  moreOffers: 'ตอบข้อนี้แล้วกด «ข้อเสนอ» เพื่อดูข้อถัดไป',
  noAccount: 'ยังไม่พบบัญชีของคุณ กรุณาเพิ่มเพื่อนอีกครั้งเพื่อเริ่มใช้งาน',
  badButton: 'ปุ่มนี้ใช้ไม่ได้แล้ว กรุณาเริ่มใหม่',
  notAllowed: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  needVersion: 'ข้อมูลมีการเปลี่ยนแปลง กรุณาตรวจสอบอีกครั้ง',
  published: 'เผยแพร่เรียบร้อยแล้ว',
  kept: 'เก็บร่างไว้แล้ว ยังไม่เผยแพร่',
  edit: 'บอกได้เลยว่าต้องการแก้ไขอะไร',
  rejected: 'ปฏิเสธข้อเสนอแล้ว',
  accepted: 'ยืนยันข้อตกลงแล้ว',
  noDraftForLocation: 'ยังไม่มีร่างที่กำลังทำอยู่ เริ่มลงขายวัสดุก่อน แล้วส่งตำแหน่งอีกครั้ง',
  locationSaved: 'บันทึกตำแหน่งที่คุณส่งแล้ว ใช้คำนวณระยะทางเส้นตรง',
  image: 'ได้รับรูปแล้ว ระบบประเมินจากรูปกำลังจะเปิดใช้งาน ตอนนี้พิมพ์ข้อมูลวัสดุให้ผู้ช่วยได้เลย',
  web: 'ดูรายละเอียดข้อตกลงได้ที่หน้าเว็บ',
  listingKept: 'ประกาศของคุณยังเปิดอยู่ เมื่อมีผู้รับซื้อใหม่ตรงเงื่อนไข ระบบจะแจ้งให้ทราบ',
  listingClosed: 'ปิดประกาศแล้ว',
  listingAlreadyClosed: 'ประกาศนี้ปิดไปแล้ว',
  unsupported: 'ยังทำรายการนี้ในแชตไม่ได้ กรุณาใช้หน้าเว็บ',
} as const;

const BALING_AGREEMENT_NOTICE = 'ยืนยันบริการอัด — ไม่ใช่หลักฐานว่าอัดเสร็จแล้ว วัสดุยังเป็นของเกษตรกร';

export interface FarmerHandlerDeps {
  identity: Pick<LineIdentityService, 'handleFollow' | 'resolveLineActor'>;
  assistant: Assistant;
  drafts: Pick<DraftService, 'get' | 'list' | 'patch' | 'publish' | 'cancel'>;
  conversations: Pick<ConversationService, 'open' | 'append' | 'setActiveDraft'>;
  offers: Pick<OfferService, 'get' | 'list' | 'accept' | 'reject'>;
  /** Read-only lists for «รายการของฉัน». Without them only open drafts are listed. */
  listings?: Pick<ListingService, 'list' | 'get' | 'close'>;
  balingRequests?: Pick<BalingRequestService, 'list'>;
  /** True when the AI assistant answers free text. Default true. Evaluated per event. */
  aiEnabled?: () => boolean;
  /** Hook for task 13.3 (image messages). Return true when the image was handled. */
  onImage?: (ctx: LineEventContext, actor: Actor) => Promise<boolean>;
}

const OPEN_DRAFT = new Set(['DRAFT', 'AWAITING_REVIEW']);
type Msg = TextMessage<AnyQuickReplyItem>;
const say = (text: string, buttons: readonly string[] = []): Msg => textMessage(text, textQuickReplies(buttons));
const fail = (r: { ok: false; error: Parameters<typeof messageThOf>[0] }): TextMessage<AnyQuickReplyItem> => say(messageThOf(r.error));

function renderAssistant(r: AssistantReply): TextMessage<AnyQuickReplyItem> {
  if (r.preview && r.draft) {
    return buildDraftPreview({
      draftId: r.draft.id,
      version: r.draft.version,
      title: r.preview.title,
      summaryLines: [...r.preview.rows.map((row) => `${row.label}: ${row.value}`), 'ยังไม่เผยแพร่ กดยืนยันเมื่อข้อมูลถูกต้อง'],
    });
  }
  // Model path: a complete draft awaiting review gets the human confirm buttons with the draft's current version.
  // The assistant itself never publishes; the button does, through drafts.publish.
  if (r.confirmable && r.draft) {
    const [title = '', ...rest] = r.text.split('\n');
    return buildDraftPreview({ draftId: r.draft.id, version: r.draft.version, title, summaryLines: rest });
  }
  const labels = textQuickReplies(r.quickReplies ?? []);
  return textMessage(r.text, r.requestLocation ? [locationQuickReply('ส่งตำแหน่งที่ตั้ง'), ...labels] : labels);
}
const MENU = FARMER_MENU;
const KG_FMT = (v: string): string => {
  const [int = '', frac = ''] = v.split('.');
  const f = frac.replace(/0+$/, '');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`;
};
const LISTING_STATUS_TH: Readonly<Record<string, string>> = { PUBLISHED: 'เปิดอยู่', PAUSED: 'พักไว้' };
const DRAFT_KIND_TH: Readonly<Record<string, string>> = {
  SALE_LISTING: 'ประกาศขาย', RESALE_LISTING: 'ประกาศขายต่อ', BALING_REQUEST: 'คำขอให้อัดฟาง', PURCHASE_DEMAND: 'ประกาศรับซื้อ', BALING_SERVICE: 'บริการอัดฟาง',
};
const MAX_LIST = 5;

export function createFarmerHandler(deps: FarmerHandlerDeps): LineChannelHandler {
  const idemKey = (ctx: LineEventContext) => `line:${ctx.webhookEventId}`;

  const aiOn = (): boolean => (deps.aiEnabled ? deps.aiEnabled() : true);

  /** The open draft this conversation is working on, if any. */
  async function openDraft(actor: Actor): Promise<{ conversationId: string; draft: { id: string; version: number } | null } | { error: Msg }> {
    const opened = await deps.conversations.open(actor);
    if (!opened.ok) return { error: fail(opened) };
    const id = opened.value.active_draft_id;
    const g = id ? await deps.drafts.get(actor, id) : null;
    const open = g && g.ok && OPEN_DRAFT.has(g.value.draft.status) ? g.value.draft : null;
    return { conversationId: opened.value.id, draft: open ? { id: open.id, version: open.version } : null };
  }

  async function help(actor: Actor): Promise<Msg> {
    const o = await openDraft(actor);
    if ('error' in o) return o.error;
    return say(o.draft ? `${FARMER_TEXT.help}\n${FARMER_TEXT.helpDraft}` : FARMER_TEXT.help, o.draft ? [...MENU, 'ยกเลิก'] : MENU);
  }

  async function cancelDraft(actor: Actor): Promise<Msg> {
    const o = await openDraft(actor);
    if ('error' in o) return o.error;
    if (!o.draft) return say(FARMER_TEXT.noOpenDraft, MENU);
    const r = await deps.drafts.cancel(actor, { draftId: o.draft.id, expectedVersion: o.draft.version });
    if (!r.ok) return fail(r);
    await deps.conversations.setActiveDraft(actor, o.conversationId, null);
    return say(FARMER_TEXT.cancelled, MENU);
  }

  async function myListings(actor: Actor): Promise<Msg> {
    const lines: string[] = [];
    if (deps.listings) {
      const r = await deps.listings.list(actor);
      if (!r.ok) return fail(r);
      const live = r.value.filter((l) => l.status === 'PUBLISHED' || l.status === 'PAUSED').slice(0, MAX_LIST);
      if (live.length) lines.push('ประกาศขายของคุณ:');
      live.forEach((l, i) => {
        const where = l.province ? ` · ${provinceLabelTh(l.province)}` : '';
        lines.push(`${i + 1}. ${MATERIAL_LABEL[l.material_type] ?? l.material_type} ${KG_FMT(l.total_qty_kg)} กก. (เหลือ ${KG_FMT(l.remaining_qty_kg)} กก.)${where} · ${LISTING_STATUS_TH[l.status] ?? l.status}`);
      });
    }
    if (deps.balingRequests) {
      const r = await deps.balingRequests.list(actor);
      if (!r.ok) return fail(r);
      const live = r.value.filter((b) => b.status === 'PUBLISHED' || b.status === 'PAUSED').slice(0, MAX_LIST);
      if (live.length) lines.push('คำขอให้อัดฟาง:');
      live.forEach((b, i) => lines.push(`${i + 1}. ${MATERIAL_LABEL[b.material_type] ?? b.material_type} ${KG_FMT(b.qty_kg)} กก. · ${LISTING_STATUS_TH[b.status] ?? b.status}`));
    }
    const drafts = await deps.drafts.list(actor);
    if (!drafts.ok) return fail(drafts);
    const open = drafts.value.filter((d) => OPEN_DRAFT.has(d.draft.status)).slice(0, MAX_LIST);
    if (open.length) lines.push('ร่างที่ยังไม่เผยแพร่:');
    open.forEach((d, i) => {
      const data = d.draft.data as Record<string, unknown>;
      const mat = typeof data.material_type === 'string' ? ` ${MATERIAL_LABEL[data.material_type] ?? data.material_type}` : '';
      const qty = typeof data.qty_kg === 'string' ? ` ${KG_FMT(data.qty_kg)} กก.` : '';
      lines.push(`${i + 1}. ${DRAFT_KIND_TH[d.draft.kind] ?? d.draft.kind}${mat}${qty} (ยังไม่เผยแพร่)`);
    });
    return say(lines.length ? ['รายการของฉัน', ...lines].join('\n') : FARMER_TEXT.noListings, MENU);
  }

  /** One pending offer at a time with accept and reject buttons: LINE shows quick replies of the last message only. */
  async function pendingOffers(actor: Actor): Promise<Msg> {
    const r = await deps.offers.list(actor, { direction: 'received', status: 'PENDING' });
    if (!r.ok) return fail(r);
    const first = r.value[0];
    if (!first) return say(FARMER_TEXT.noOffers, MENU);
    const item = (label: string, action: 'offer_accept' | 'offer_reject'): AnyQuickReplyItem => ({
      type: 'action',
      action: { type: 'postback', label, data: encodePostback({ action, id: first.id, version: first.version }), displayText: label },
    });
    const more = r.value.length - 1;
    const text = [offerText('created', first), ...(more > 0 ? [`ยังมีอีก ${more} ข้อเสนอ ${FARMER_TEXT.moreOffers}`] : [])].join('\n');
    return textMessage(text, [item('ตอบรับ', 'offer_accept'), item('ปฏิเสธ', 'offer_reject')]);
  }

  async function onText(ctx: LineEventContext, actor: Actor, text: string): Promise<void> {
    // Menu and global commands work in every mode and in the middle of a form. They are matched only when the whole
    // message is the command, so normal answers still reach the form. sourceEventId makes a replayed job a no-op.
    const intent = detectMenuIntent(text);
    if (intent === 'HELP' || intent === 'MY_LISTINGS' || intent === 'OFFERS' || intent === 'CANCEL') {
      const opened = await deps.conversations.open(actor);
      if (!opened.ok) return ctx.reply([fail(opened)]);
      const seen = await deps.conversations.append(actor, { conversationId: opened.value.id, direction: 'IN', text: text.trim().slice(0, 2000) || intent, sourceEventId: ctx.webhookEventId });
      if (seen.ok && seen.value === null) return; // duplicate delivery: already answered
      const msg = intent === 'HELP' ? await help(actor) : intent === 'CANCEL' ? await cancelDraft(actor) : intent === 'OFFERS' ? await pendingOffers(actor) : await myListings(actor);
      return ctx.reply([msg]);
    }
    const r = await deps.assistant.handle(actor, { text, sourceEventId: ctx.webhookEventId });
    if (!r.ok) return ctx.reply([fail(r)]);
    if (r.value === null) return;
    return ctx.reply([renderAssistant(r.value)]);
  }
  async function onLocation(ctx: LineEventContext, actor: Actor, lat: number, lng: number): Promise<void> {
    const opened = await deps.conversations.open(actor);
    if (!opened.ok) return ctx.reply([fail(opened)]);
    const draftId = opened.value.active_draft_id;
    const current = draftId ? await deps.drafts.get(actor, draftId) : null;
    if (!current || !current.ok || !OPEN_DRAFT.has(current.value.draft.status)) return ctx.reply([say(FARMER_TEXT.noDraftForLocation)]);
    // Stored as the user's own coordinates (Requirement 6.6). Never derived from a place name.
    const patched = await deps.drafts.patch(actor, {
      draftId: current.value.draft.id,
      expectedVersion: current.value.draft.version,
      patch: { lat: lat.toFixed(6), lng: lng.toFixed(6) },
    });
    if (!patched.ok) return ctx.reply([fail(patched)]);
    if (!aiOn()) {
      // Step form: the location answer is done, so the form moves to its next question or the review.
      const next = await deps.assistant.handle(actor, { text: LOCATION_SHARED_TEXT, sourceEventId: ctx.webhookEventId });
      if (!next.ok) return ctx.reply([fail(next)]);
      if (next.value === null) return;
      return ctx.reply([say(FARMER_TEXT.locationSaved), renderAssistant(next.value)]);
    }
    return ctx.reply([say(FARMER_TEXT.locationSaved, ['แก้ไข', 'เก็บร่าง'])]);
  }

  async function acceptOffer(ctx: LineEventContext, actor: Actor, offerId: string, version: number | undefined): Promise<TextMessage<AnyQuickReplyItem>> {
    const offer = await deps.offers.get(actor, offerId);
    if (!offer.ok) return fail(offer);
    // A repeated tap (new LINE event, old version) on an offer this receiver already accepted gets the same
    // confirmation: the service replays the existing agreement and writes nothing. Pending offers keep the check.
    const alreadyMine = offer.value.status === 'ACCEPTED' && offer.value.to_org_id === actor.orgId;
    if (!alreadyMine && (version === undefined || offer.value.version !== version)) return say(FARMER_TEXT.needVersion, ['ข้อเสนอ']);
    // The key is per offer, not per webhook event: a second tap is a new event but the same request, so the
    // service replays the stored outcome and writes nothing (no second idempotency row either).
    const r: Result<unknown> = await deps.offers.accept(actor, { offerId, idempotencyKey: `line:accept:${offerId}` });
    if (!r.ok) return fail(r);
    const agreement = (r.value as Partial<AcceptResult> | undefined)?.agreement;
    const lines: string[] = [FARMER_TEXT.accepted];
    if (agreement) lines.push(`ปริมาณตามข้อตกลง: ${agreement.qty_kg} กก.`);
    // A baling agreement is a service confirmation, not a purchase: it must not say "การรับซื้อ" or imply the straw is baled.
    lines.push(agreement?.kind === 'BALING_SERVICE' ? BALING_AGREEMENT_NOTICE : AGREEMENT_NOTICE);
    return say(lines.join('\n'), MENU);
  }

  /** Keep or close a listing from the publish-result buttons. The service checks ownership; a closed listing replies calmly. */
  async function listingChoice(actor: Actor, action: 'listing_keep' | 'listing_close', id: string): Promise<Msg> {
    if (!deps.listings) return say(FARMER_TEXT.unsupported, MENU);
    const g = await deps.listings.get(actor, id); // NOT_FOUND for a listing of another organization
    if (!g.ok) return fail(g);
    const closed = g.value.status === 'CLOSED' || g.value.status === 'CANCELLED';
    if (closed) return say(FARMER_TEXT.listingAlreadyClosed, MENU);
    if (action === 'listing_keep') return say(FARMER_TEXT.listingKept, MENU);
    const r = await deps.listings.close(actor, { id, expectedVersion: g.value.version });
    return r.ok ? say(FARMER_TEXT.listingClosed, MENU) : fail(r);
  }

  async function onPostback(ctx: LineEventContext, actor: Actor, data: string): Promise<void> {
    const decoded = decodePostback(data);
    if (!decoded.ok) return ctx.reply([say(FARMER_TEXT.badButton)]);
    const { action, id, version } = decoded.value;
    if (!isPostbackActionAllowed(actor.role, action)) return ctx.reply([say(FARMER_TEXT.notAllowed)]);
    switch (action) {
      case 'draft_confirm': {
        if (version === undefined) return ctx.reply([say(FARMER_TEXT.needVersion)]);
        const r = await deps.drafts.publish(actor, { draftId: id, expectedVersion: version, idempotencyKey: idemKey(ctx) });
        if (!r.ok) return ctx.reply([fail(r)]);
        // The form session ends here: the next message starts from the menu, not from the published draft.
        const opened = await deps.conversations.open(actor);
        if (opened.ok && opened.value.active_draft_id === id) await deps.conversations.setActiveDraft(actor, opened.value.id, null);
        return ctx.reply([say(FARMER_TEXT.published, MENU)]);
      }
      case 'draft_keep': {
        const r = await deps.drafts.get(actor, id);
        return ctx.reply([r.ok ? say(FARMER_TEXT.kept, MENU) : fail(r)]);
      }
      case 'draft_edit': {
        const d = await deps.drafts.get(actor, id);
        if (!d.ok) return ctx.reply([fail(d)]);
        const opened = await deps.conversations.open(actor);
        if (!opened.ok) return ctx.reply([fail(opened)]);
        const set = await deps.conversations.setActiveDraft(actor, opened.value.id, id);
        if (!set.ok) return ctx.reply([fail(set)]);
        // Step form: show the list of fields to change instead of inviting free text.
        if (!aiOn()) return onText(ctx, actor, 'แก้ไข');
        return ctx.reply([say(FARMER_TEXT.edit)]);
      }
      case 'offer_accept':
        return ctx.reply([await acceptOffer(ctx, actor, id, version)]);
      case 'offer_reject': {
        // A repeated tap on an offer this receiver already rejected gets the same reply; nothing is written.
        const current = await deps.offers.get(actor, id);
        if (current.ok && current.value.status === 'REJECTED' && current.value.to_org_id === actor.orgId) {
          return ctx.reply([say(FARMER_TEXT.rejected, ['ข้อเสนอ'])]);
        }
        const r = await deps.offers.reject(actor, { offerId: id, ...(version !== undefined ? { expectedVersion: version } : {}) }, { idempotencyKey: idemKey(ctx) });
        return ctx.reply([r.ok ? say(FARMER_TEXT.rejected, ['ข้อเสนอ']) : fail(r)]);
      }
      case 'agreement_view':
        return ctx.reply([say(FARMER_TEXT.web)]);
      case 'listing_keep':
      case 'listing_close':
        return ctx.reply([await listingChoice(actor, action, id)]);
      default:
        return ctx.reply([say(FARMER_TEXT.unsupported)]);
    }
  }

  return async (ctx) => {
    const e = ctx.event;
    if (e.kind === 'ignored') return;
    if (e.kind === 'follow') {
      // Creates the personal FARMER organization once (A7). A repeated follow reuses it.
      await deps.identity.handleFollow({ channel: 'farmer', lineUserId: e.lineUserId });
      return ctx.reply([say(aiOn() ? FARMER_TEXT.greeting : FARMER_TEXT.greetingButtons, MENU)]);
    }
    const actor = await deps.identity.resolveLineActor('farmer', e.lineUserId);
    if (!actor) return ctx.reply([say(FARMER_TEXT.noAccount)]);
    switch (e.kind) {
      case 'text':
        return onText(ctx, actor, e.text);
      case 'location':
        return onLocation(ctx, actor, e.latitude, e.longitude);
      case 'postback':
        return onPostback(ctx, actor, e.data);
      case 'image':
        if (deps.onImage && (await deps.onImage(ctx, actor))) return;
        return ctx.reply([say(FARMER_TEXT.image)]);
    }
  };
}
