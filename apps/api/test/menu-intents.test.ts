import { describe, expect, it } from 'vitest';
import { detectMenuIntent } from '../src/domain/menu-intents.js';
import { FARMER_MAIN_MENU } from '../src/assistant/index.js';

describe('detectMenuIntent', () => {
  it.each([
    ['ลงขาย', 'SALE'], ['ลงขายวัสดุ', 'SALE'], ['ขาย', 'SALE'], ['อยากขาย', 'SALE'], ['อยากขายฟาง', 'SALE'], ['อยากขายฟางข้าวครับ', 'SALE'],
    ['ประกาศขาย', 'SALE'], ['ประกาศขาย ', 'SALE'], ['sell', 'SALE'],
    ['หาผู้รับอัด', 'BALING_REQUEST'], ['จ้างอัด', 'BALING_REQUEST'], ['อัดฟาง', 'BALING_REQUEST'], ['อยากจ้างอัดฟาง', 'BALING_REQUEST'], ['คำขอให้อัดฟาง', 'BALING_REQUEST'],
    ['รายการของฉัน', 'MY_LISTINGS'], ['ดูรายการ', 'MY_LISTINGS'], ['ประกาศของฉัน', 'MY_LISTINGS'], ['อยากดูรายการขาย', 'MY_LISTINGS'],
    ['ข้อเสนอ', 'OFFERS'], ['ดูข้อเสนอ', 'OFFERS'], ['ข้อเสนอของฉันค่ะ', 'OFFERS'],
    ['เมนู', 'HELP'], ['ช่วยเหลือ', 'HELP'], ['help', 'HELP'],
    ['ยกเลิก', 'CANCEL'], ['ยกเลิกร่าง', 'CANCEL'], ['ยกเลิกครับ', 'CANCEL'],
  ] as const)('%s -> %s', (text, intent) => {
    expect(detectMenuIntent(text)).toBe(intent);
  });

  it('recognizes every button label the system itself sends', () => {
    for (const label of FARMER_MAIN_MENU) expect(detectMenuIntent(label)).not.toBeNull();
  });

  it('does not treat form answers as commands', () => {
    for (const answer of ['ฟางข้าว', 'อื่นๆ', '5 ตัน', 'ต่อรองได้', 'ราคาตายตัว', 'นครสวรรค์', 'ข้าม', 'แก้ไข', 'เก็บร่าง', 'ยืนยันเผยแพร่', 'ที่แปลง', 'ขายฟางข้าว 5 ตัน', 'ประกาศขายต่อ', '2 บาท/กก.', 'พรุ่งนี้', '']) {
      expect(detectMenuIntent(answer)).toBeNull();
    }
  });
});
