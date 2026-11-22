// Copy for the public /pitch microsite: the 6-minute concept pitch (9 slides), Thai only.
// Source: agrimatch-presentation.md. Every figure without a source is an assumption and is labelled as one on the slide.
export const PITCH_COUNT = 9;
export const DEMO_HREF = '/presentation';
export const FACTORY_HREF = '/login?role=factory';
export const FARMER_HREF = '/login?role=farmer';

export interface Item { icon: string; text: string; title?: string }
export interface Table { head: string[]; rows: string[][]; foot?: string[] }
export interface Slide {
  nav: string; time: string; title: string; lead?: string;
  items?: Item[];
  /** Left-to-right steps, each starting with its own icon. */
  flow?: { icon: string; text: string }[];
  table?: Table; tableNote?: string;
  /** Plain-text formula lines; no LaTeX so it renders anywhere. */
  formula?: string[];
  warn?: string; assume?: string;
  /** What the presenter says, written the way people talk. */
  say: string;
}

export function parsePitchSlide(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^[1-9]$/.test(value)) return 0;
  return Number(value) - 1;
}

export const PITCH_SITE = {
  title: 'AgriMatch: ทำให้เศษพืชมีค่า แทนการเผา',
  description: 'แนวคิดโครงการ Agrimatch: จับคู่เกษตรกรกับผู้รับซื้อเศษพืช และวางทางไปสู่คาร์บอนเครดิตที่ตรวจสอบได้ ตัวเลขที่ไม่มีแหล่งอ้างอิงเป็นสมมติฐาน',
  status: 'สถานะ: แนวคิดและโครงการนำร่อง ตัวเลขที่ไม่มีแหล่งอ้างอิงเป็นสมมติฐาน',
  prev: 'ก่อนหน้า', next: 'ถัดไป', say: 'ดูบทพูด', hideSay: 'ซ่อนบทพูด', navLabel: 'เลื่อนสไลด์', slideWord: 'สไลด์',
  demoCta: 'ลองดูต้นแบบที่ทำไว้',
};

export const SLIDES: Slide[] = [
  {
    nav: 'เปิดเรื่อง', time: '0:00–0:40', title: 'เศษพืชหลังเก็บเกี่ยว ทำไมยังถูกเผา',
    items: [
      { icon: '🌾', text: 'ชานอ้อย ไม้ ฟางข้าว เหลือหลังเก็บเกี่ยวทุกปี' },
      { icon: '🔥', text: 'เผาคือวิธีที่ถูกที่สุดในวันนี้' },
      { icon: '😷', text: 'ควันจากการเผาเป็นต้นทางหนึ่งของฝุ่น PM 2.5' },
    ],
    say: 'ทุกหน้าเก็บเกี่ยว ในแปลงจะเหลือเศษพืชกองใหญ่ เกษตรกรรายเล็กส่วนใหญ่ไม่มีทางเลือกอื่น ก็เลยต้องเผา Agrimatch อยากทำให้เศษพวกนี้มีมูลค่า จะได้ไม่ใช่ของที่ต้องทิ้ง',
  },
  {
    nav: 'ปัญหา', time: '0:40–1:15', title: 'เศษกระจัดกระจาย รวบรวมยาก',
    lead: 'นครสวรรค์ เป็นพื้นที่ที่เผาเยอะ และมีโรงงานรับซื้ออยู่ด้วย',
    items: [
      { icon: '🧩', text: 'วัตถุดิบกระจายอยู่ตามแปลงเล็ก ผู้รวบรวมต้องตระเวนหาเอง' },
      { icon: '⛽', text: 'เสียค่าน้ำมันและเวลาไปกับการค้นหา' },
      { icon: '🚫', text: 'รายใหญ่เลือกแต่แปลงที่สะดวก รายเล็กที่อยู่ไกลเลยไม่มีใครรับ' },
    ],
    say: 'รายเล็กที่อยู่ไกล บางทีรายใหญ่ก็ไม่สนใจ สุดท้ายก็ต้องเผาต่อ ปัญหาจริงๆ คือข้อมูลไปไม่ถึงกัน ไม่ใช่ไม่มีวัตถุดิบ',
  },
  {
    nav: 'AI Match', time: '1:15–2:00', title: 'AI Match: ให้เศษวัสดุไปถึงคนที่รับซื้อ',
    lead: 'ต้นน้ำ → กลางน้ำ',
    flow: [
      { icon: '🚜', text: 'เกษตรกรรายเล็ก' }, { icon: '📍', text: 'โพสต์พิกัดและปริมาณ' }, { icon: '🤖', text: 'AI Match' },
      { icon: '🚛', text: 'ผู้รวบรวมกดรับ' }, { icon: '🧱', text: 'อัดก้อน' },
    ],
    say: 'เกษตรกรโพสต์ว่าอยู่ตรงไหน มีเศษเท่าไหร่ ระบบจะจับคู่ให้ผู้รวบรวมขับไปรับได้ตรงจุดเลย รายใหญ่ประหยัดเวลากับน้ำมัน รายเล็กก็มีรายได้ แทนที่จะเผา',
  },
  {
    nav: 'คาร์บอน', time: '2:00–2:45', title: 'คาร์บอนเครดิต: ทำไมผู้ซื้อปลายน้ำยอมจ่ายเพิ่ม',
    lead: 'กลางน้ำ → ปลายน้ำ',
    flow: [
      { icon: '🧱', text: 'เศษอัดก้อน' }, { icon: '🏭', text: 'โรงอัดชีวมวล (เช่น KPW Energy)' },
      { icon: '🏷️', text: 'เชื้อเพลิงพร้อมหลักฐานคาร์บอน' }, { icon: '⚡', text: 'โรงไฟฟ้า / โรงงานอุตสาหกรรม' },
    ],
    warn: 'เครดิตต้องผ่านการตรวจสอบจากหน่วยที่ได้รับการรับรอง (T-VER / TGO) ไม่ได้เกิดขึ้นเอง',
    say: 'ฝั่งปลายน้ำจะถามว่า ทำไมต้องซื้อเชื้อเพลิงชีวมวลที่แพงกว่า คำตอบคือถ้ามีหลักฐานการลดคาร์บอนติดมาด้วย ผู้ซื้อก็ได้ประโยชน์ตรงนั้น แต่ขอพูดไว้ก่อนว่าเครดิตต้องผ่านการตรวจสอบจาก T-VER หรือ TGO ไม่ใช่ได้มาเลย',
  },
  {
    nav: 'วงจรตลาด', time: '2:45–3:20', title: 'วงจรที่หมุนต่อได้เอง',
    flow: [
      { icon: '⚡', text: 'ปลายน้ำซื้อมากขึ้น' }, { icon: '🏭', text: 'โรงอัดต้องการเศษมากขึ้น' }, { icon: '🚜', text: 'ชาวนามีเหตุผลขายเศษ' },
      { icon: '🌾', text: 'เผาน้อยลง' }, { icon: '🌬️', text: 'PM 2.5 ลดลง' },
    ],
    say: 'พอปลายน้ำซื้อมากขึ้น กลางน้ำก็ต้องการเศษมากขึ้น ชาวนาก็มีเหตุผลที่จะไม่เผา วงจรนี้ทำให้การลดเผาอยู่ได้ด้วยตัวมันเอง ไม่ต้องรอแรงกดดันจากภายนอกตลอด',
  },
  {
    nav: 'โรงงานจริง', time: '3:20–4:05', title: 'สิ่งที่เรารู้จากโรงงาน KPW Energy',
    table: {
      head: ['ข้อมูล', 'ค่า', 'สถานะ'],
      rows: [
        ['ปริมาณรับซื้อช่วงพีค', 'ประมาณ 100 ตัน/วัน', 'จากการพูดคุย ยังไม่มีเอกสาร'],
        ['ราคารับซื้อหน้าโรงงาน (ช่วงปิดหีบ)', '700–800 บาท/ตัน', 'จากการพูดคุย'],
        ['ความต้องการ', 'อยากมีโครงการคาร์บอนเครดิต', 'จากการพูดคุย'],
      ],
    },
    formula: ['ต้นทุนขนส่งต่อตัน ≈ (2 × 25 บาท/กม. × ระยะทาง) ÷ น้ำหนักต่อเที่ยว'],
    assume: 'ตารางด้านล่างคำนวณจากสูตร ไม่ใช่ข้อมูลจริง',
    tableNote: '__transport__',
    say: 'ตัวเลขจากโรงงานบอกว่ามีความต้องการจริง ส่วนเรื่องขนส่ง ถ้าไกลหน่อย เศษหลวมแพ้ค่าน้ำมันเยอะมาก แต่ถ้าอัดก้อนก่อน ต้นทุนต่อตันลดลงได้เยอะ ตัวเลขชุดนี้ได้จากการพูดคุย ยังไม่มีเอกสารรองรับ',
  },
  {
    nav: 'สูตรคาร์บอน', time: '4:05–4:50', title: 'คำนวณได้ว่าลดคาร์บอนไปเท่าไหร่',
    formula: [
      'ER = Q × [ EF_burn + s × EF_sub − EF_proj ] × (1 − H)',
      'EF_burn = (4.51 × 28 + 0.069 × 265) ÷ 1000 ≈ 0.145 tCO₂e/ตัน',
      'EF_sub = 14 GJ/ตัน × 0.0946 tCO₂/GJ ≈ 1.32 tCO₂/ตัน',
    ],
    table: {
      head: ['สัญลักษณ์', 'ความหมาย', 'ค่าที่ใช้'],
      rows: [
        ['ER', 'ปริมาณการลดการปล่อย (tCO₂e)', 'ผลลัพธ์'],
        ['Q', 'ปริมาณเศษที่ใช้ (ตัน/ปี)', '12,000 (สมมติ)'],
        ['EF_burn', 'ปล่อยจากการเผาที่หลีกเลี่ยงได้', '≈ 0.145 tCO₂e/ตัน'],
        ['s', 'สัดส่วนที่ใช้แทนถ่านหิน', '50% (สมมติ ยังไม่ยืนยัน)'],
        ['EF_sub', 'ปล่อยจากถ่านหินที่ถูกแทนที่', '≈ 1.32 tCO₂/ตัน'],
        ['EF_proj', 'ปล่อยจากโครงการ (ขนส่ง อัด)', '0.05 tCO₂e/ตัน'],
        ['H', 'ส่วนหักความไม่แน่นอน (haircut)', '20%'],
      ],
      foot: ['ผลตัวอย่าง', '12,000 ตัน/ปี → ≈ 0.61 tCO₂e/ตัน', 'รวม ≈ 7,265 tCO₂e/ปี'],
    },
    assume: 'ค่า Q และ s เป็นสมมติฐาน ค่าทั้งหมดต้องผ่านการตรวจสอบตามวิธีการของ T-VER ก่อนนำไปขาย',
    say: 'สูตรนี้นับสามส่วน คือการเผาที่เลี่ยงได้ การที่ไปแทนถ่านหิน และหักการปล่อยจากตัวโครงการเอง แล้วหักเผื่ออีก 20% ให้ระมัดระวังไว้ก่อน ค่าทั้งหมดต้องผ่านการตรวจสอบตามวิธีการของ T-VER ก่อนเอาไปขายได้',
  },
  {
    nav: 'รายได้', time: '4:50–5:30', title: 'รายได้ก่อนและหลังมีแอป',
    lead: 'ตัวเลขทั้งหมดในสไลด์นี้เป็นสมมติฐาน',
    items: [
      { icon: '🔥', title: 'ก่อนมีแอป (สมมติ)', text: 'เกษตรกร 1 ราย มีเศษ 10 ตัน เผาทิ้ง รายได้จากเศษ 0 บาท' },
      { icon: '💰', title: 'หลังมีแอป (สมมติ)', text: 'ขายเศษผ่าน Agrimatch ที่ 700 บาท/ตัน ได้ 7,000 บาท/รอบ' },
      { icon: '🏷️', title: 'ถ้ามีคาร์บอนเครดิต (สมมติ)', text: 'ราคาคาร์บอน 300 บาท/tCO₂e เกษตรกรได้ส่วนแบ่ง 40%' },
    ],
    table: {
      head: ['รายการ (ระดับโครงการ ต่อปี)', 'ค่า'],
      rows: [
        ['ปริมาณลดการปล่อย', '≈ 7,265 tCO₂e'],
        ['มูลค่าคาร์บอนทั้งหมด (300 บาท/t)', '≈ 2.18 ล้านบาท'],
        ['ส่วนแบ่งเกษตรกร (40%)', '≈ 0.87 ล้านบาท'],
      ],
    },
    say: 'ก่อนมีแอป เศษพวกนี้ไม่มีมูลค่าเลย พอมีแอป เกษตรกรได้เงินจากการขายเศษ และถ้าผ่านการรับรอง ก็มีส่วนแบ่งจากคาร์บอนเพิ่มอีก ตัวเลขทั้งหมดนี้เป็นสมมติฐานนะครับ ต้องพิสูจน์ในโครงการนำร่อง',
  },
  {
    nav: 'ก้าวต่อไป', time: '5:30–6:00', title: 'จากแนวคิดสู่โครงการนำร่อง',
    items: [
      { icon: '🧭', text: 'เลือกวิธีการ (methodology) ของ T-VER ที่ใช้ได้กับเศษพืชและการอัดก้อน' },
      { icon: '🧪', text: 'ทำโครงการนำร่องในพื้นที่เดียว คือนครสวรรค์' },
      { icon: '📋', text: 'เก็บข้อมูลผ่านแพลตฟอร์มตามฟิลด์ที่วิธีการกำหนด' },
      { icon: '🔍', text: 'ให้หน่วยตรวจสอบอิสระดูระบบตั้งแต่ต้น' },
      { icon: '🏷️', text: 'ยื่นขอขึ้นทะเบียนและขอออกเครดิตเมื่อข้อมูลพร้อม' },
    ],
    say: 'Agrimatch ไม่ได้ขายคาร์บอนตั้งแต่วันแรก เราเริ่มจากทำให้เศษพืชมีมูลค่าก่อน แล้วสร้างข้อมูลที่ตรวจสอบได้ เพื่อให้คาร์บอนเครดิตเป็นผลพลอยได้ที่อยู่ได้นาน ขอบคุณครับ',
  },
];

// Transport table: recomputed from the formula so the slide cannot drift from it.
export function transportPerTon(km: number, tonsPerTrip: number): number {
  return Math.round((2 * 25 * km) / tonsPerTrip);
}
export const TRANSPORT_TABLE: Table = {
  head: ['ระยะทาง', 'เศษหลวม (6 ตัน/เที่ยว)', 'เศษอัดก้อน (15 ตัน/เที่ยว)'],
  rows: [20, 50].map((km) => [`${km} กม.`, `≈ ${transportPerTon(km, 6)} บาท/ตัน`, `≈ ${transportPerTon(km, 15)} บาท/ตัน`]),
};

/** Sources for the notes line under the last slide (same list as the script). */
export const SOURCES = ['so05.tci-thaijo.org', 'tei.or.th', 'PMC21243095', 'IPCC NGGIP (ch4wb2.pdf)', 'nationthailand (บทความ TGO)', 'tver.tgo.or.th'];

/** Which real screen the phone frame shows for each slide (same order as SLIDES). Pages behind login ask to sign in first. */
export const PHONE_SCREENS: { href: string; label: string }[] = [
  { href: FARMER_HREF, label: 'เกษตรกรเข้าระบบผ่าน LINE' },
  { href: FARMER_HREF, label: 'เกษตรกรเข้าระบบผ่าน LINE' },
  { href: '/factory/market', label: 'ตลาดวัสดุ: ผลจับคู่' },
  { href: '/factory/orders', label: 'คำสั่งซื้อขายที่ยืนยันแล้ว' },
  { href: '/factory', label: 'ภาพรวมธุรกิจ' },
  { href: '/factory/shipping', label: 'การจัดส่ง' },
  { href: '/factory/reports', label: 'รายงาน' },
  { href: '/factory/reports', label: 'รายงาน: มูลค่าและปริมาณ' },
  { href: FACTORY_HREF, label: 'ลองเข้าใช้งานเอง' },
];
