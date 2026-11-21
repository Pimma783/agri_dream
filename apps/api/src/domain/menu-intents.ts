// Menu and global commands in the farmer chat (task 10.5). Pure: no I/O.
// A command is recognized only when the WHOLE message clearly is that command (after removing spaces and polite
// particles). A normal answer such as "5 ตัน" or "ฟางข้าว" never matches, so commands can be checked mid-form.
import { normalizeText } from './step-parsers.js';

export type MenuIntent = 'SALE' | 'BALING_REQUEST' | 'MY_LISTINGS' | 'OFFERS' | 'HELP' | 'CANCEL';

const POLITE_TAIL = /(?:นะครับ|นะคะ|นะค่ะ|ครับ|ค่ะ|คะ|นะ|หน่อย|ด้วย)+$/u;
const LEAD = '(?:อยาก|ต้องการ|ขอ|จะ|ช่วย)?';
const SEE = '(?:อยากดู|ขอดู|ต้องการดู|ดู|เช็คดู|เช็ค|เช็ก)?';

const CANCEL = /^(?:ยกเลิก(?:ร่าง|รายการ|ประกาศ|การลงขาย|ฟอร์ม)?|cancel)$/u;
const HELP = /^(?:เมนู(?:หลัก)?|กลับเมนู|ช่วยเหลือ|วิธีใช้|ช่วย|help|menu)$/u;
const OFFERS = new RegExp(`^${SEE}(?:ข้อเสนอ(?:ของฉัน|ของผม|ที่ได้รับ|ที่รอ)?|offers?)$`, 'u');
const LISTINGS = new RegExp(`^${SEE}(?:รายการ|ประกาศ)(?:ของฉัน|ของผม|ของเรา|ขาย|ที่ลง|ที่ขาย|ทั้งหมด)?$|^(?:my)?listings?$`, 'u');
const BALING = new RegExp(
  `^${LEAD}(?:หาผู้รับอัด|หาคนรับอัด|หาคนอัด|หารถอัด|หาที่อัด|จ้างอัด|ให้อัด|คำขอให้อัด|อัด)(?:ฟาง(?:ข้าว)?)?$`,
  'u',
);
// Sale: "ลงขาย", "ลงขายวัสดุ", "ประกาศขาย", "ขาย", "อยากขายฟาง", "sell". No digits (that would be an answer) and not "ขายต่อ".
const SALE = new RegExp(`^${LEAD}(?:ลงขาย|ประกาศขาย|ขาย)(?!ต่อ)(?!รายการ)[^\\d]{0,30}$|^sell$`, 'u');

const compact = (raw: string): string => normalizeText(raw).toLowerCase().replace(/\s+/g, '').replace(POLITE_TAIL, '');

export function detectMenuIntent(raw: string): MenuIntent | null {
  const s = compact(raw);
  if (!s) return null;
  if (CANCEL.test(s)) return 'CANCEL';
  if (HELP.test(s)) return 'HELP';
  if (OFFERS.test(s)) return 'OFFERS';
  if (BALING.test(s)) return 'BALING_REQUEST';
  if (SALE.test(s)) return 'SALE'; // before listings: «ประกาศขาย» starts a sale, «อยากดูรายการขาย» lists
  if (LISTINGS.test(s)) return 'MY_LISTINGS';
  return null;
}
