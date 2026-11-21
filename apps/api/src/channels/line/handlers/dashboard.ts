// Shared LINE handler for the baler and factory channels (task 9.10, Requirements 1.5, 3.2, 11.9, 15.2).
// Balers and factories work mainly in the Dashboard; this handler keeps their LINE OA correct and safe:
//   - follow creates an UNLINKED identity only; a link code typed here binds it (generic failure for every refusal);
//   - a linked actor gets a small menu, a list of pending received offers with accept/reject buttons, and top matches;
//   - the actor comes only from the verified LINE user on this channel; a postback is a request, the service authorizes;
//   - AI chat is off for these roles in the demo, so free text points to the Dashboard;
//   - message text, link codes and tokens are never logged, and nothing is sent on another role's channel.
import type { Actor } from '../../../domain/permissions.js';
import { messageThOf, type AcceptResult, type MatchReadService, type OfferService, type Result } from '../../../services/index.js';
import { offerText } from '../../../services/index.js';
import { normalizeLinkCode, type LineIdentityService } from '../../../services/identity/index.js';
import { decodePostback, encodePostback, isPostbackActionAllowed } from '../codec.js';
import {
  AGREEMENT_NOTICE, ESTIMATE_LABEL, textMessage, textQuickReplies, type AnyQuickReplyItem, type TextMessage,
} from '../messages.js';
import type { LineChannelHandler, LineEventContext } from './types.js';
export const DASHBOARD_MENU = ['ข้อเสนอ', 'ผลจับคู่'] as const;
export const DASHBOARD_TEXT = {
  noOffers: 'ไม่มีข้อเสนอที่รอตอบ',
  noMatches: 'ยังไม่มีผลจับคู่',
  badButton: 'ปุ่มนี้ใช้ไม่ได้แล้ว กรุณาเริ่มใหม่',
  notAllowed: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  needVersion: 'ข้อมูลมีการเปลี่ยนแปลง กรุณาตรวจสอบอีกครั้ง',
  accepted: 'ยืนยันข้อตกลงแล้ว',
  rejected: 'ปฏิเสธข้อเสนอแล้ว',
  unsupported: 'ยังทำรายการนี้ในแชตไม่ได้ กรุณาใช้ Dashboard',
  unknownProvince: 'ไม่ระบุจังหวัด',
} as const;
const BALING_AGREEMENT_NOTICE = 'ยืนยันบริการอัด — ไม่ใช่หลักฐานว่าอัดเสร็จแล้ว วัสดุยังเป็นของเกษตรกร';
const MAX_OFFERS = 5;
const MAX_MATCHES = 5;
const DASHBOARD_LABEL = 'เปิด Dashboard';
export interface DashboardHandlerDeps {
  identity: Pick<LineIdentityService, 'handleFollow' | 'resolveLineActor' | 'redeemLinkCode'>;
  offers: Pick<OfferService, 'get' | 'list' | 'accept' | 'reject'>;
  matches: Pick<MatchReadService, 'list'>;
  /** WEB_ORIGIN, e.g. https://app.example.org. Used to build Dashboard links. */
  webOrigin: string;
}
type Msg = TextMessage<AnyQuickReplyItem>;
const say = (text: string, buttons: readonly AnyQuickReplyItem[] = []): Msg => textMessage(text, buttons);
const fail = (r: { ok: false; error: Parameters<typeof messageThOf>[0] }): Msg => say(messageThOf(r.error));
export function createDashboardHandler(channel: 'baler' | 'factory', deps: DashboardHandlerDeps): LineChannelHandler {
  const origin = deps.webOrigin.replace(/\/+$/, '');
  const dashboardItem = (): AnyQuickReplyItem => ({ type: 'action', action: { type: 'uri', label: DASHBOARD_LABEL, uri: `${origin}/` } });
  const menu = (): AnyQuickReplyItem[] => [dashboardItem(), ...textQuickReplies(DASHBOARD_MENU)];
  const linkPrompt = (): Msg =>
    say(`ยังไม่ได้ผูกบัญชี ขอรหัสผูกบัญชี 8 ตัวอักษรจากหน้า Dashboard ที่ ${origin}/settings/line แล้วพิมพ์รหัสในแชตนี้`);
  const dashboardReply = (): Msg =>
    say(`ตอนนี้ผู้ช่วย AI ในแชตนี้ยังปิดอยู่ในเดโม กรุณาใช้ Dashboard: ${origin}/ หรือกดเมนูด้านล่าง`, menu());
  async function onLinkedText(ctx: LineEventContext, actor: Actor, text: string): Promise<void> {
    const t = text.trim();
    if (t === 'ข้อเสนอ') return listOffers(ctx, actor);
    if (t === 'ผลจับคู่') return listMatches(ctx, actor);
    if (t === DASHBOARD_LABEL || t === 'เมนู') return ctx.reply([say(`เปิด Dashboard: ${origin}/`, menu())]);
    return ctx.reply([dashboardReply()]);
  }
  async function listOffers(ctx: LineEventContext, actor: Actor): Promise<void> {
    const r = await deps.offers.list(actor, { direction: 'received', status: 'PENDING' });
    if (!r.ok) return ctx.reply([fail(r)]);
    if (r.value.length === 0) return ctx.reply([say(DASHBOARD_TEXT.noOffers, menu())]);
    const messages: Msg[] = r.value.slice(0, MAX_OFFERS).map((o) => {
      const ref = { id: o.id, version: o.version };
      const item = (label: string, action: 'offer_accept' | 'offer_reject'): AnyQuickReplyItem => ({
        type: 'action',
        action: { type: 'postback', label, data: encodePostback({ action, ...ref }), displayText: label },
      });
      return say(offerText('created', o), [item('ตอบรับ', 'offer_accept'), item('ปฏิเสธ', 'offer_reject')]);
    });
    return ctx.reply(messages);
  }
  async function listMatches(ctx: LineEventContext, actor: Actor): Promise<void> {
    const r = await deps.matches.list(actor, { limit: MAX_MATCHES });
    if (!r.ok) return ctx.reply([fail(r)]);
    if (r.value.length === 0) return ctx.reply([say(DASHBOARD_TEXT.noMatches, menu())]);
    // Province level only: no names, coordinates, distances or contact data. The score is an estimate, not a price.
    const lines = r.value.slice(0, MAX_MATCHES).map(
      (m, i) => `${i + 1}. ${m.counterparty.province ?? DASHBOARD_TEXT.unknownProvince} · ${ESTIMATE_LABEL} คะแนน ${m.score}`,
    );
    return ctx.reply([say([`ผลจับคู่ (${ESTIMATE_LABEL})`, ...lines, `ดูรายละเอียดที่ ${origin}/`].join('\n'), menu())]);
  }
  async function acceptOffer(ctx: LineEventContext, actor: Actor, offerId: string, version: number | undefined): Promise<Msg> {
    const offer = await deps.offers.get(actor, offerId);
    if (!offer.ok) return fail(offer); // another organization's offer id is NOT_FOUND
    // Same rule as the farmer handler: a repeated tap on an offer this receiver already accepted gets the same confirmation.
    const alreadyMine = offer.value.status === 'ACCEPTED' && offer.value.to_org_id === actor.orgId;
    if (!alreadyMine && (version === undefined || offer.value.version !== version)) return say(DASHBOARD_TEXT.needVersion, menu());
    const r: Result<unknown> = await deps.offers.accept(actor, { offerId, idempotencyKey: `line:accept:${offerId}` });
    if (!r.ok) return fail(r);
    const agreement = (r.value as Partial<AcceptResult> | undefined)?.agreement;
    const lines: string[] = [DASHBOARD_TEXT.accepted];
    if (agreement) lines.push(`ปริมาณตามข้อตกลง: ${agreement.qty_kg} กก.`);
    lines.push(agreement?.kind === 'BALING_SERVICE' ? BALING_AGREEMENT_NOTICE : AGREEMENT_NOTICE);
    return say(lines.join('\n'), menu());
  }
  async function rejectOffer(ctx: LineEventContext, actor: Actor, offerId: string, version: number | undefined): Promise<Msg> {
    const current = await deps.offers.get(actor, offerId);
    if (!current.ok) return fail(current);
    if (current.value.status === 'REJECTED' && current.value.to_org_id === actor.orgId) return say(DASHBOARD_TEXT.rejected, menu());
    const r = await deps.offers.reject(
      actor,
      { offerId, ...(version !== undefined ? { expectedVersion: version } : {}) },
      { idempotencyKey: `line:${ctx.webhookEventId}` },
    );
    return r.ok ? say(DASHBOARD_TEXT.rejected, menu()) : fail(r);
  }
  async function onPostback(ctx: LineEventContext, actor: Actor, data: string): Promise<void> {
    const decoded = decodePostback(data);
    if (!decoded.ok) return ctx.reply([say(DASHBOARD_TEXT.badButton)]);
    const { action, id, version } = decoded.value;
    if (!isPostbackActionAllowed(actor.role, action)) return ctx.reply([say(DASHBOARD_TEXT.notAllowed)]);
    if (action === 'offer_accept') return ctx.reply([await acceptOffer(ctx, actor, id, version)]);
    if (action === 'offer_reject') return ctx.reply([await rejectOffer(ctx, actor, id, version)]);
    return ctx.reply([say(DASHBOARD_TEXT.unsupported, menu())]);
  }
  async function onUnlinkedText(ctx: LineEventContext, lineUserId: string, text: string): Promise<void> {
    if (normalizeLinkCode(text) === null) return ctx.reply([linkPrompt()]);
    const r = await deps.identity.redeemLinkCode({ channel, lineUserId, code: text });
    if (!r.ok) return ctx.reply([say(r.error.message_th)]); // one generic message for every refusal
    return ctx.reply([say(`ผูกบัญชีสำเร็จ: ${r.value.organizationName}\nใช้เมนูด้านล่างหรือเปิด Dashboard ได้เลย`, menu())]);
  }
  return async (ctx) => {
    const e = ctx.event;
    if (e.kind === 'ignored') return;
    if (e.kind === 'follow') {
      // An UNLINKED identity only: no organization is created for balers and factories.
      const followed = await deps.identity.handleFollow({ channel, lineUserId: e.lineUserId });
      return ctx.reply([followed.actor ? say('ยินดีต้อนรับกลับ', menu()) : linkPrompt()]);
    }
    const actor = await deps.identity.resolveLineActor(channel, e.lineUserId);
    if (!actor) {
      if (e.kind === 'text') return onUnlinkedText(ctx, e.lineUserId, e.text);
      return ctx.reply([linkPrompt()]);
    }
    if (e.kind === 'text') return onLinkedText(ctx, actor, e.text);
    if (e.kind === 'postback') return onPostback(ctx, actor, e.data);
    return ctx.reply([dashboardReply()]);
  };
}
