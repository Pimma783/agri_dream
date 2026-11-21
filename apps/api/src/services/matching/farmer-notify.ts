// Layer: services. LINE messages to the farmer after matching (task 23.2).
// Written with the recompute transaction, so a rolled-back run queues nothing, and keyed by dedupe_key so a repeat is a no-op.
// Estimates are labelled «ประมาณการ». Nothing here is a buyer price. No buyer name or contact data.
import { D } from '../../domain/units.js';
import { lineIdentities, outbox, type Db, type Listing } from '../../repos/index.js';
import { formatKgTh } from './notify.js';

const MATERIAL_TH: Readonly<Record<string, string>> = {
  RICE_STRAW: 'ฟางข้าว', CANE_LEAF: 'ใบอ้อย', CORN_COB: 'ซังข้าวโพด', OTHER: 'วัสดุเหลือใช้',
};
const SMALL_LOT_KG = new D(5000);
const MAX_TIPS = 3;
export const NO_MATCH_HEAD = 'ตอนนี้ยังไม่มีผู้รับซื้อที่ตรงเงื่อนไข ประกาศของคุณยังเปิดอยู่';
export const KEEP_LABEL = 'เปิดประกาศไว้';
export const CLOSE_LABEL = 'ปิดประกาศ';

export interface PublishResultStats {
  /** Distinct buyer organizations that match the listing right now. */
  buyers: number;
  /** Smallest straight-line distance in km among the matches, as a decimal string. */
  nearestKm: string | null;
}

const lot = (l: Pick<Listing, 'material_type' | 'remaining_qty_kg'>): string =>
  `${MATERIAL_TH[l.material_type] ?? MATERIAL_TH.OTHER} ${formatKgTh(l.remaining_qty_kg)}`.trim();

function km(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : v;
}

/** Up to three tips derived only from the listing's own fields. Same listing data gives the same tips in the same order. */
export function listingTips(l: Listing): string[] {
  const tips: string[] = [];
  if (l.price_mode === 'FIXED') tips.push('ตั้งราคาตายตัวอยู่ ลองเปิดให้ต่อรองได้ จะมีผู้สนใจมากขึ้น');
  if (new D(l.remaining_qty_kg).lessThan(SMALL_LOT_KG)) tips.push('ปริมาณน้อย ลองรวมกับเพื่อนบ้าน หรือใช้บริการอัดฟาง');
  if (l.lat === null || l.lng === null) tips.push('ส่งตำแหน่งที่ตั้ง เพื่อจับคู่ผู้รับซื้อในรัศมี 80 กม. ได้แม่นขึ้น');
  if (l.pending_material && l.expected_ready_at === null) tips.push('ระบุวันที่วัสดุพร้อมส่ง ผู้รับซื้อจะวางแผนได้');
  if (l.transport_by === 'UNKNOWN') tips.push('ระบุว่าใครขนส่ง ผู้รับซื้อจะตัดสินใจง่ายขึ้น');
  if (l.available_from === null && l.available_to === null) tips.push('ระบุช่วงเวลาที่ส่งมอบได้');
  tips.push('ผู้รับซื้อต้องอยู่ในรัศมี 80 กม. จากที่ตั้งของคุณ');
  return tips.slice(0, MAX_TIPS);
}

export function publishResultText(l: Listing, s: PublishResultStats): string {
  if (s.buyers > 0) {
    const lines = [`ประกาศ ${lot(l)} มีผู้รับซื้อที่ตรงเงื่อนไข ${s.buyers} ราย`];
    if (s.nearestKm !== null) lines.push(`ใกล้สุดประมาณ ${km(s.nearestKm)} กม. (เส้นตรง ประมาณการ)`);
    lines.push('รอผู้รับซื้อส่งข้อเสนอ ราคาจริงขึ้นกับข้อเสนอของผู้รับซื้อ ดูรายละเอียดที่หน้าเว็บ');
    return lines.join('\n');
  }
  return [
    NO_MATCH_HEAD,
    'ต้องการเปิดประกาศไว้รอผู้รับซื้อใหม่ไหม',
    ...listingTips(l).map((t, i) => `${i + 1}. ${t}`),
  ].join('\n');
}

export function newPairText(l: Listing, distanceKm: string | null): string {
  const lines = [`มีผู้รับซื้อใหม่ตรงกับประกาศ ${lot(l)}`];
  if (distanceKm !== null) lines.push(`ระยะประมาณ ${km(distanceKm)} กม. (เส้นตรง ประมาณการ)`);
  lines.push('รอผู้รับซื้อส่งข้อเสนอ ราคาจริงขึ้นกับข้อเสนอของผู้รับซื้อ');
  return lines.join('\n');
}

const quickReply = (label: string, action: 'listing_keep' | 'listing_close', l: Listing) => ({
  type: 'action',
  // Same wire format as channels/line/codec.ts (`action=<action>&id=<id>&v=<version>`); the farmer handler decodes it.
  action: { type: 'postback', label, data: `action=${action}&id=${l.id}&v=${l.version}`, displayText: label },
});

/** Queue one push per LINKED farmer identity of the listing's organization. Skips silently when none is linked. */
async function enqueueToFarmer(db: Db, l: Listing, text: string, withButtons: boolean, dedupe: (identityId: string) => string): Promise<number> {
  const identities = (await lineIdentities.listByOrg(db, l.org_id)).filter((i) => i.status === 'LINKED' && i.channel === 'farmer');
  let queued = 0;
  for (const identity of identities) {
    const message = {
      type: 'text',
      text,
      ...(withButtons ? { quickReply: { items: [quickReply(KEEP_LABEL, 'listing_keep', l), quickReply(CLOSE_LABEL, 'listing_close', l)] } } : {}),
    };
    const row = await outbox.enqueue(db, {
      channel: 'farmer', to_line_identity_id: identity.id, message: [message], dedupe_key: dedupe(identity.id),
      related_type: 'listing', related_id: l.id,
    });
    if (row) queued++;
  }
  return queued;
}

/** One result push per listing: later version bumps (offer acceptance, edits) never re-send it. */
export const notifyPublishResult = (db: Db, l: Listing, s: PublishResultStats): Promise<number> =>
  enqueueToFarmer(db, l, publishResultText(l, s), s.buyers === 0, (id) => `farmer-publish-result:${l.id}:${id}`);

/** One push per new (listing, demand) pair. */
export const notifyNewPair = (db: Db, l: Listing, demandId: string, distanceKm: string | null): Promise<number> =>
  enqueueToFarmer(db, l, newPairText(l, distanceKm), false, (id) => `farmer-new-match:${l.id}:${demandId}:${id}`);
