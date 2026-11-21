// Outbox rows for offer events. Written with the caller's transaction so a rolled-back change queues nothing
// (Requirement 15.1), and keyed by dedupe_key so a repeat insert is a no-op (Requirement 15.5).
// The text has terms only: no contact data, no names. Created and replaced offers carry accept and reject buttons.
import { lineIdentities, organizations, outbox, type Db, type Offer } from '../../repos/index.js';

export type OfferEvent = 'created' | 'replaced' | 'rejected' | 'withdrawn' | 'expired' | 'accepted';

const CHANNEL_OF_KIND = { FARMER: 'farmer', BALER: 'baler', BUYER_FACTORY: 'factory' } as const;
const UNIT_TH = { KG: 'บาท/กก.', TON: 'บาท/ตัน', BALE: 'บาท/ก้อน' } as const;
const TRANSPORT_TH = { SELLER: 'ผู้ขายจัดส่ง', BUYER: 'ผู้ซื้อรับเอง', EITHER: 'ตกลงกันได้', UNKNOWN: 'ยังไม่ระบุ' } as const;
const HEAD_TH: Record<OfferEvent, string> = {
  created: 'มีข้อเสนอใหม่',
  replaced: 'ผู้ส่งแก้ข้อเสนอ มีข้อเสนอใหม่แทนข้อเสนอเดิม',
  rejected: 'ข้อเสนอของคุณถูกปฏิเสธ',
  withdrawn: 'ผู้ส่งถอนข้อเสนอแล้ว',
  expired: 'ข้อเสนอหมดอายุแล้ว',
  accepted: 'ข้อเสนอได้รับการตอบรับ ข้อตกลงยืนยันแล้ว',
};

export function offerText(event: OfferEvent, o: Offer): string {
  const lines = [HEAD_TH[event], `ปริมาณ: ${o.qty_kg} กก.`];
  if (event === 'created' || event === 'replaced') {
    lines.push(
      o.unit_price_thb !== null && o.price_unit !== null ? `ราคา: ${o.unit_price_thb} ${UNIT_TH[o.price_unit]}` : 'ราคา: ยังไม่ระบุ (ต่อรอง)',
    );
    if (o.total_amount_thb !== null) lines.push(`ยอดรวม: ${o.total_amount_thb} บาท (ไม่รวมค่าขนส่ง)`);
    lines.push(`ขนส่ง: ${TRANSPORT_TH[o.transport_by]}`);
    lines.push(
      o.transport_cost_thb !== null ? `ค่าขนส่งแยกต่างหาก: ${o.transport_cost_thb} บาท` : 'ค่าขนส่ง: ยังไม่ทราบ (แยกจากยอดรวม)',
    );
    if (o.ack_pending_material) lines.push('วัสดุอยู่ระหว่างรอรับ/รออัด');
    lines.push(`หมดอายุ: ${o.expires_at.toISOString()}`);
  }
  if (event === 'accepted') {
    if (o.total_amount_thb !== null) lines.push(`ยอดรวม: ${o.total_amount_thb} บาท (ไม่รวมค่าขนส่ง)`);
    lines.push(
      o.kind === 'BALING_SERVICE'
        ? 'ยืนยันบริการอัด — ไม่ใช่หลักฐานว่าอัดเสร็จแล้ว วัสดุยังเป็นของเกษตรกร'
        : 'นี่คือการยืนยันข้อตกลง ไม่ใช่หลักฐานการชำระเงิน การส่งมอบ หรือการตรวจคุณภาพ',
    );
  }
  return lines.join('\n');
}

const postbackButton = (label: string, action: 'offer_accept' | 'offer_reject', o: Offer) => ({
  type: 'action',
  // Same wire format as channels/line/codec.ts (`action=<action>&id=<id>&v=<version>`); the farmer handler decodes it.
  action: { type: 'postback', label, data: `action=${action}&id=${o.id}&v=${o.version}`, displayText: label },
});

/**
 * A new or replacing offer carries accept and reject buttons that hold the offer version, on the receiver's own channel.
 * Only LINKED identities get a row (see notifyOrg), and the handler for each channel authorizes the tap as that actor.
 */
function messageFor(event: OfferEvent, offer: Offer): Array<Record<string, unknown>> {
  const text = offerText(event, offer);
  if (event === 'created' || event === 'replaced') {
    return [{ type: 'text', text, quickReply: { items: [postbackButton('ตอบรับ', 'offer_accept', offer), postbackButton('ปฏิเสธ', 'offer_reject', offer)] } }];
  }
  return [{ type: 'text', text }];
}

/** Queue one message per linked LINE identity of the organization on the channel that matches its kind. Returns rows queued. */
export async function notifyOrg(db: Db, orgId: string, event: OfferEvent, offer: Offer): Promise<number> {
  const org = await organizations.get(db, orgId);
  if (!org) return 0;
  const channel = CHANNEL_OF_KIND[org.kind];
  const identities = (await lineIdentities.listByOrg(db, orgId)).filter((i) => i.status === 'LINKED' && i.channel === channel);
  let queued = 0;
  for (const identity of identities) {
    const row = await outbox.enqueue(db, {
      channel,
      to_line_identity_id: identity.id,
      message: messageFor(event, offer),
      dedupe_key: `offer:${offer.id}:${event}:${identity.id}`,
      related_type: 'offer',
      related_id: offer.id,
    });
    if (row) queued++;
  }
  return queued;
}
