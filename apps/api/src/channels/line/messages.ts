// LINE message builders (design.md A12: P0 uses text, quick reply and postback buttons). Pure: no I/O.
// Numbers arrive already computed and formatted by the backend; builders only lay them out.
// Nothing here may state that anything was paid, delivered or quality-checked (Requirement 19.4).
import type { PriceUnit } from '../../domain/units.js';
import { encodePostback } from './codec.js';

export const ASSESSMENT_DISCLAIMER = 'การประเมินเบื้องต้นจากภาพ ไม่ใช่ผลตรวจคุณภาพจริง';
export const AGREEMENT_NOTICE =
  'การรับซื้อในระบบหมายถึงการยืนยันข้อตกลงเท่านั้น ไม่ใช่หลักฐานการชำระเงิน การส่งมอบ หรือการตรวจคุณภาพ';
export const ESTIMATE_LABEL = 'ประมาณการ';

const MAX_TEXT = 5000;
const MAX_QUICK_REPLIES = 13;
const MAX_LABEL = 20;

export interface PostbackAction {
  readonly type: 'postback';
  readonly label: string;
  readonly data: string;
  readonly displayText?: string;
}
/** Quick reply that sends its label as a user text message (menu shortcuts). */
export interface MessageAction {
  readonly type: 'message';
  readonly label: string;
  readonly text: string;
}
export interface QuickReplyItem {
  readonly type: 'action';
  readonly action: PostbackAction;
}
export interface MessageQuickReplyItem {
  readonly type: 'action';
  readonly action: MessageAction;
}
/** Quick reply that opens a web page (the Dashboard link). */
export interface UriQuickReplyItem {
  readonly type: 'action';
  readonly action: { readonly type: 'uri'; readonly label: string; readonly uri: string };
}
/** Quick reply that opens the LINE location picker. The user's own location arrives as a location message. */
export interface LocationQuickReplyItem {
  readonly type: 'action';
  readonly action: { readonly type: 'location'; readonly label: string };
}
export type AnyQuickReplyItem = QuickReplyItem | MessageQuickReplyItem | UriQuickReplyItem | LocationQuickReplyItem;
export const locationQuickReply = (label: string): LocationQuickReplyItem => ({ type: 'action', action: { type: 'location', label: clip(label, MAX_LABEL) } });
export interface TextMessage<I extends AnyQuickReplyItem = QuickReplyItem> {
  readonly type: 'text';
  readonly text: string;
  readonly quickReply?: { readonly items: readonly I[] };
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

function button(label: string, data: string): QuickReplyItem {
  return { type: 'action', action: { type: 'postback', label: clip(label, MAX_LABEL), data, displayText: clip(label, MAX_LABEL) } };
}

/** Text shortcut buttons: tapping one sends the label as a message. */
export function textQuickReplies(labels: readonly string[]): MessageQuickReplyItem[] {
  return labels.slice(0, MAX_QUICK_REPLIES).map((l) => {
    const label = clip(l, MAX_LABEL);
    return { type: 'action', action: { type: 'message', label, text: label } };
  });
}
export function textMessage<I extends AnyQuickReplyItem = QuickReplyItem>(text: string, buttons: readonly I[] = []): TextMessage<I> {
  const base = { type: 'text' as const, text: clip(text, MAX_TEXT) };
  return buttons.length === 0 ? base : { ...base, quickReply: { items: buttons.slice(0, MAX_QUICK_REPLIES) } };
}

/** Any image-based assessment text always carries the constant disclaimer. */
export function assessmentText(lines: readonly string[]): string {
  return [...lines, ASSESSMENT_DISCLAIMER].join('\n');
}

export interface DraftPreviewInput {
  readonly draftId: string;
  readonly version: number;
  readonly title: string;
  readonly summaryLines: readonly string[];
  readonly assessmentLines?: readonly string[];
}

/** Requirement 5.2: summary with «ยืนยันเผยแพร่», «แก้ไข», «เก็บร่าง». Buttons carry the draft version. */
export function buildDraftPreview(input: DraftPreviewInput): TextMessage {
  const lines = [input.title, ...input.summaryLines];
  const body =
    input.assessmentLines && input.assessmentLines.length > 0
      ? [...lines, assessmentText(input.assessmentLines)].join('\n')
      : lines.join('\n');
  const ref = { id: input.draftId, version: input.version };
  return textMessage(body, [
    button('ยืนยันเผยแพร่', encodePostback({ action: 'draft_confirm', ...ref })),
    button('แก้ไข', encodePostback({ action: 'draft_edit', ...ref })),
    button('เก็บร่าง', encodePostback({ action: 'draft_keep', ...ref })),
  ]);
}

export const PRICE_UNIT_LABEL_TH: Readonly<Record<PriceUnit, string>> = {
  THB_PER_KG: 'บาท/กก.',
  THB_PER_TON: 'บาท/ตัน',
  THB_PER_BALE: 'บาท/ก้อน',
};

export type TransportBy = 'SELLER' | 'BUYER' | 'EITHER' | 'UNKNOWN';
export const TRANSPORT_LABEL_TH: Readonly<Record<TransportBy, string>> = {
  SELLER: 'ผู้ขายรับผิดชอบขนส่ง',
  BUYER: 'ผู้ซื้อรับผิดชอบขนส่ง',
  EITHER: 'ตกลงกันได้ว่าฝ่ายใดขนส่ง',
  UNKNOWN: 'ยังไม่ระบุผู้รับผิดชอบขนส่ง',
};

export interface OfferCardInput {
  readonly offerId: string;
  readonly version: number;
  readonly senderName: string;
  readonly quantityText: string; // kilograms, formatted by the backend
  readonly priceText: string;
  readonly priceUnit: PriceUnit;
  readonly transportBy: TransportBy;
  readonly transportCostText?: string | null; // shown separately, never folded into a total
  readonly totalText?: string | null;
}

/** Requirement 11.9: quantity, price, price unit, transport responsibility, accept and reject buttons. */
export function buildOfferCard(input: OfferCardInput): TextMessage {
  const lines = [
    `ข้อเสนอจาก ${input.senderName}`,
    `ปริมาณ: ${input.quantityText} กก.`,
    `ราคา: ${input.priceText} ${PRICE_UNIT_LABEL_TH[input.priceUnit]}`,
    `ขนส่ง: ${TRANSPORT_LABEL_TH[input.transportBy]}`,
  ];
  if (input.totalText) lines.push(`ยอดรวม: ${input.totalText} บาท (ไม่รวมค่าขนส่ง)`);
  if (input.transportCostText) lines.push(`ค่าขนส่งแยกต่างหาก: ${input.transportCostText} บาท`);
  const ref = { id: input.offerId, version: input.version };
  return textMessage(lines.join('\n'), [
    button('ตอบรับ', encodePostback({ action: 'offer_accept', ...ref })),
    button('ปฏิเสธ', encodePostback({ action: 'offer_reject', ...ref })),
  ]);
}

export interface AgreementNoticeInput {
  readonly agreementId: string;
  readonly quantityText: string;
  readonly remainingText: string;
}

/** Agreement notice with the "not payment, delivery or quality" text (Requirement 12.11). */
export function buildAgreementNotice(input: AgreementNoticeInput): TextMessage {
  const text = [
    'ยืนยันข้อตกลงแล้ว',
    `ปริมาณตามข้อตกลง: ${input.quantityText} กก.`,
    `ปริมาณคงเหลือ: ${input.remainingText} กก.`,
    AGREEMENT_NOTICE,
  ].join('\n');
  return textMessage(text, [button('ดูข้อตกลง', encodePostback({ action: 'agreement_view', id: input.agreementId }))]);
}

export interface MatchCardInput {
  readonly counterpartyName: string;
  readonly materialLabel: string;
  readonly distanceKmText?: string | null; // straight-line distance
  readonly reasons: readonly string[]; // rendered by matching/explain.th
  readonly estimates?: readonly { readonly label: string; readonly valueText: string }[];
  readonly askPriceText?: string | null; // a real price stated by the counterparty
  readonly askPriceUnit?: PriceUnit | null;
}

/** Match card: backend numbers only. Estimates are labelled «ประมาณการ» and kept apart from real prices. */
export function buildMatchCard(input: MatchCardInput): TextMessage {
  const lines = [`${input.counterpartyName} · ${input.materialLabel}`];
  if (input.distanceKmText) lines.push(`ระยะเส้นตรง ${input.distanceKmText} กม.`);
  if (input.askPriceText && input.askPriceUnit) {
    lines.push(`ราคาที่ผู้ประกาศระบุ: ${input.askPriceText} ${PRICE_UNIT_LABEL_TH[input.askPriceUnit]}`);
  }
  for (const reason of input.reasons) lines.push(`• ${reason}`);
  for (const e of input.estimates ?? []) lines.push(`${ESTIMATE_LABEL}: ${e.label} ${e.valueText}`);
  return textMessage(lines.join('\n'));
}
