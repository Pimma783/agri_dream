// Static copy for the public /presentation microsite (Thai first, English second).
// Facts come from docs/HANDOVER.md, docs/submission.md, .kiro/steering and the code in apps/api and infra/hosting.
// Nothing here may contain secrets. Estimates and interview figures are labelled where they appear.
export type Lang = 'th' | 'en';
export const SLIDE_COUNT = 5;
export const FARMER_LOGIN_HREF = '/login?role=farmer';
export const FACTORY_LOGIN_HREF = '/login?role=factory';

export function parseLang(value: string | string[] | undefined): Lang {
  return value === 'en' ? 'en' : 'th';
}
/** `?s=1..5` to a 0-based index; anything else opens the first slide. */
export function parseSlide(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^[1-5]$/.test(value)) return 0;
  return Number(value) - 1;
}

type LabelKey =
  | 'users' | 'browser' | 'line' | 'oa' | 'express' | 'appTask' | 'nginx' | 'next' | 'api' | 'worker' | 'workerText' | 'db' | 'dbText'
  | 'bedrock' | 'bedrockText' | 'linePush' | 'secrets' | 'logs' | 'build' | 'ecr' | 'buildTitle' | 'runtimeTitle' | 'supportTitle';
export interface Point { icon: string; title: string; text: string; tag?: string }
export interface Step { text: string }
export interface Arch { label: string; text: string }
export interface Copy {
  siteTitle: string; description: string; prev: string; next: string; langLabel: string; slideWord: string;
  speakerNotes: string; hideNotes: string; navLabel: string;
  intro: { nav: string; title: string; lead: string; points: Point[]; notes: string };
  problem: { nav: string; title: string; lead: string; points: Point[]; calcTitle: string; calc: string; notes: string };
  solution: { nav: string; title: string; lead: string; roles: Point[]; flowTitle: string; flow: string[]; points: Point[]; notes: string };
  tech: {
    nav: string; title: string; lead: string; labels: Record<LabelKey, string>; points: Point[]; notes: string;
  };
  demo: {
    nav: string; title: string; lead: string; cta: string; farmerNote: string; farmerLink: string; stepsTitle: string; steps: Step[];
    accountTitle: string; email: string; password: string; accountMissing: string; accountNote: string;
    limitsTitle: string; limits: string[]; notes: string;
  };
}

const th: Copy = {
  siteTitle: 'AgriMatch: จับคู่เศษวัสดุเกษตรกับผู้รับซื้อ',
  description: 'AgriMatch ช่วยเกษตรกรนครสวรรค์ อุตรดิตถ์ กำแพงเพชร ลงขายฟางและเศษวัสดุเกษตรผ่าน LINE และให้ผู้รับซื้อเห็นผลจับคู่ ประมาณการราคาและระยะทาง',
  prev: 'ก่อนหน้า', next: 'ถัดไป', langLabel: 'ภาษา', slideWord: 'สไลด์', navLabel: 'เลื่อนสไลด์',
  speakerNotes: 'บทพูด', hideNotes: 'ซ่อนบทพูด',
  intro: {
    nav: 'แนะนำ', title: 'AgriMatch คืออะไร',
    lead: 'ช่วยให้เกษตรกรขายฟางข้าว อ้อย และข้าวโพดให้ผู้รับซื้อ แทนการเผา',
    points: [
      { icon: '🌾', title: 'เกษตรกรรายย่อย', text: 'แจ้งเศษวัสดุที่มีผ่าน LINE ไม่ต้องติดตั้งแอป ไม่ต้องจ่ายค่าใช้งาน' },
      { icon: '🏭', title: 'โรงงานชีวมวล', text: 'บอกความต้องการรับซื้อ แล้วเห็นผลจับคู่ที่วัสดุ ปริมาณ และระยะทางตรงเงื่อนไข' },
      { icon: '🚜', title: 'ผู้อัดฟางและรับจ้างอัด', text: 'เปิดบริการอัดฟาง และขายต่อฟางที่รับซื้อมา' },
      { icon: '📍', title: 'พื้นที่นำร่อง', text: 'นครสวรรค์ อุตรดิตถ์ กำแพงเพชร (ตัวเลือกอำเภอรองรับเฉพาะ 3 จังหวัดนี้)' },
    ],
    notes: 'AgriMatch เป็นตลาดจับคู่ ไม่ใช่ระบบชำระเงิน ระบบใช้งานจริงบน AWS แล้ว วันนี้จะเล่าปัญหา วิธีแก้ สถาปัตยกรรม และให้ลองใช้เอง',
  },
  problem: {
    nav: 'ปัญหา', title: 'ปัญหาของเกษตรกรและโรงงาน',
    lead: 'ปัญหาจริงคือข้อมูลไม่ถึงกัน ไม่ใช่ไม่มีผู้ต้องการ',
    points: [
      { icon: '🔥', title: 'เผาเพราะถูกที่สุด', text: 'ฟางข้าว อ้อย ข้าวโพด ถูกเผาในแปลง ควันเป็นแหล่งหนึ่งของ PM2.5' },
      { icon: '🗺️', title: 'วัสดุกระจายแปลงเล็ก', text: 'ผู้รวบรวมเสียน้ำมันและเวลาตามหา ผู้ซื้อรายใหญ่เลือกแปลงที่สะดวก เกษตรกรไกลจึงไม่มีผู้ซื้อ' },
      { icon: '🏭', title: 'โรงงานหาวัตถุดิบไม่ตรงเงื่อนไข', text: 'ต้องการวัสดุ รูปแบบ ปริมาณ และช่วงเวลาที่แน่นอน', tag: 'จากการสัมภาษณ์ ยังไม่มีเอกสาร: โรงงานชีวมวล (KPW Energy) ใช้ราว 100 ตัน/วันช่วงสูงสุด รับซื้อราว 700–800 บาท/ตันที่หน้าโรงงาน' },
      { icon: '🚚', title: 'ค่าขนส่งต่อตันสูงเมื่อไม่อัดก้อน', text: 'การอัดก้อนทำให้ขนได้ต่อเที่ยวมากขึ้น' },
    ],
    calcTitle: 'ตัวอย่างคำนวณ (จากสมมติฐาน ไม่ใช่ผลวัดจริง)',
    calc: 'ค่าขนส่งต่อตัน ≈ 2 × 25 บาท/กม. × ระยะทาง ÷ ตันต่อเที่ยว ที่ 20 กม.: ฟางหลวม 6 ตัน ≈ 167 บาท/ตัน, อัดก้อน 15 ตัน ≈ 67 บาท/ตัน',
    notes: 'ย้ำว่าตัวเลขสัมภาษณ์และตัวอย่างคำนวณเป็นสมมติฐาน ผลจริงต้องวัดในช่วงนำร่อง',
  },
  solution: {
    nav: 'วิธีแก้', title: 'ผ่าน LINE สามบทบาท จับคู่ และข้อเสนอซื้อ',
    lead: 'ระบบจับคู่ให้ แล้วให้คนตัดสินใจเอง',
    roles: [
      { icon: '🌾', title: 'เกษตรกร (LINE)', text: 'ลงขายทีละขั้นหรือคุยกับ AI ภาษาไทย แนบรูปถ่ายเพื่อตรวจได้ (ไม่บังคับ)' },
      { icon: '🏭', title: 'โรงงานรับซื้อ (Dashboard)', text: 'สร้างความต้องการ ดูผลจับคู่ ส่งข้อเสนอซื้อ' },
      { icon: '🚜', title: 'ผู้อัดฟาง (Dashboard)', text: 'เปิดบริการรับจ้างอัด ส่งข้อเสนอ และสร้างประกาศขายต่อ' },
    ],
    flowTitle: 'ลำดับการทำงาน',
    flow: ['เกษตรกรลงขาย', 'ระบบจับคู่', 'กระดิ่งแจ้งโรงงาน', 'โรงงานส่งข้อเสนอ', 'เกษตรกรตอบรับใน LINE', 'ได้ข้อตกลง'],
    points: [
      { icon: '🎯', title: 'จับคู่ด้วยกฎ', text: 'ตรวจวัสดุ รูปแบบ ปริมาณ ช่วงเวลา ระยะทางไม่เกิน 80 กม. แล้วให้คะแนน ราคาและระยะทางแสดงเป็น «ประมาณการ»' },
      { icon: '🔔', title: 'แจ้งเตือน', text: 'โรงงานเห็นกระดิ่งเมื่อมีคู่ใหม่ เกษตรกรได้ LINE สรุปหลังลงขาย ถ้าไม่มีผู้ซื้อจะได้คำแนะนำและปุ่ม «เปิดประกาศไว้» หรือ «ปิดประกาศ»' },
      { icon: '🤝', title: 'ข้อตกลง', text: 'เมื่อรับข้อเสนอจะมีข้อตกลงที่ลดปริมาณคงเหลือ ไม่ใช่การชำระเงินหรือการรับรองคุณภาพ' },
    ],
    notes: 'ข้อเสนอส่งจาก Dashboard และเกษตรกรตอบรับใน LINE ขั้นตอนนี้ผ่านการทดสอบอัตโนมัติ ส่วนผ่านเว็บและ LINE จริงบนระบบที่โฮสต์ยังต้องยืนยันซ้ำ',
  },
  tech: {
    nav: 'เทคนิค', title: 'สถาปัตยกรรมที่ใช้งานอยู่บน AWS',
    lead: 'Region ap-southeast-1 (สิงคโปร์)',
    labels: {
      users: 'ผู้ใช้', browser: 'เว็บ Dashboard', line: 'LINE ผู้ใช้', oa: 'LINE Official Account ×3', express: 'ECS Express Mode (HTTPS + load balancer)',
      appTask: 'งานแอป (Fargate 1 งาน)', nginx: 'nginx :8080', next: 'Next.js :3000', api: 'Express API :4000',
      worker: 'Worker (Fargate แยก)', workerText: 'ประมวลผล event, outbox, จับคู่', db: 'RDS PostgreSQL 16', dbText: 'ไม่เปิดสาธารณะ เก็บรูปเป็น bytea',
      bedrock: 'Amazon Bedrock', bedrockText: 'claude-sonnet-5 แชทไทยและตรวจรูป', linePush: 'LINE Messaging API',
      secrets: 'Secrets Manager', logs: 'CloudWatch Logs', build: 'CodeBuild', ecr: 'ECR', buildTitle: 'การ build', runtimeTitle: 'การทำงาน', supportTitle: 'สนับสนุน',
    },
    points: [
      { icon: '🔐', title: 'ความลับ', text: 'ค่า LINE, session และฐานข้อมูลอยู่ใน Secrets Manager ฉีดเข้า task ตอนรัน ไม่อยู่ในโค้ดหรือภาพ' },
      { icon: '🧪', title: 'ข้อมูล', text: 'ฐานข้อมูลใช้ผู้ใช้สิทธิ์จำกัด (ไม่แก้โครงสร้างตาราง) และ webhook ตรวจลายเซ็น LINE' },
      { icon: '🧠', title: 'AI', text: 'ถ้า Bedrock ล้มเหลว เกษตรกรถูกส่งไปแบบฟอร์มทีละขั้นอัตโนมัติ' },
    ],
    notes: 'เว็บและ API อยู่ใน task เดียวกันผ่าน nginx ทำให้ cookie เป็น origin เดียว worker แยก service ฐานข้อมูลเดียว ไม่มี S3 สำหรับรูป',
  },
  demo: {
    nav: 'ทดลอง', title: 'ทดลองใช้งานเอง', lead: 'กดเข้าไปลองได้เลย ใช้เวลาประมาณ 2 นาที',
    cta: 'ทดลองใช้งาน', farmerNote: 'ฝั่งเกษตรกร: สแกน QR LINE ของเกษตรกรที่หน้านี้', farmerLink: 'เปิด QR เกษตรกร',
    stepsTitle: 'ขั้นตอนทดลอง',
    steps: [
      { text: 'เข้าสู่ระบบด้วยบัญชีทดลองของโรงงาน' },
      { text: 'สร้างความต้องการ: ฟางข้าว นครสวรรค์' },
      { text: 'เปิด «ผลจับคู่» และดูกระดิ่งแจ้งเตือน' },
      { text: 'ส่งข้อเสนอซื้อไปยังเกษตรกร' },
      { text: 'เกษตรกรตอบรับใน LINE (สแกน QR เกษตรกร)' },
      { text: 'ดูข้อตกลงที่เมนู «ข้อตกลง»' },
    ],
    accountTitle: 'บัญชีโรงงาน (สำหรับกรรมการ)', email: 'อีเมล', password: 'รหัสผ่าน',
    accountMissing: 'ขอบัญชีทดลองจากทีมงาน',
    accountNote: 'บัญชีนี้ถูกจำกัดสิทธิ์ (จัดการสมาชิกและตั้งค่าองค์กรไม่ได้) และจะถูกรีเซ็ตหลังการตัดสิน',
    limitsTitle: 'ข้อจำกัดที่ต้องรู้',
    limits: [
      'ข้อมูลเป็นตัวอย่างสำหรับนำร่อง ราคาและระยะทางเป็นประมาณการ ไม่ใช่ราคาจริงของผู้ซื้อ',
      'ยังไม่ได้วัดการเข้าร่วมจริงของผู้ซื้อ และยังไม่ได้วัดประหยัดค่าขนส่งจากการรวมวัสดุ',
      'ไม่มีการชำระเงิน และไม่มีการซื้อขายคาร์บอนเครดิตใน MVP',
      'เครดิตคาร์บอนเป็นทิศทางอนาคตเท่านั้น ต้องผ่านการรับรอง T-VER/TGO ไม่มีการรับประกันเครดิต ผู้ซื้อ หรือรายได้',
      'ตรวจรูปใช้กฎและ AI ช่วย ไม่ใช่โมเดล CNN ที่ฝึกแล้ว',
      'LINE ของโรงงานและผู้อัดฟางยังเป็นข้อความพื้นฐาน ใช้ Dashboard เป็นหลัก',
      'ขั้นข้อเสนอ → ตอบรับ → ข้อตกลง ผ่านการทดสอบอัตโนมัติ ยังไม่ได้ยืนยันบนระบบที่โฮสต์',
    ],
    notes: 'เชิญกรรมการกด «ทดลองใช้งาน» และพูดข้อจำกัดให้ครบก่อนจบ',
  },
};

const en: Copy = {
  siteTitle: 'AgriMatch: matching crop residue with buyers',
  description: 'AgriMatch helps farmers in Nakhon Sawan, Uttaradit and Kamphaeng Phet post rice straw and crop residue on LINE, and shows buyers matches with estimated prices and distances.',
  prev: 'Previous', next: 'Next', langLabel: 'Language', slideWord: 'Slide', navLabel: 'Slide navigation',
  speakerNotes: 'Speaker notes', hideNotes: 'Hide notes',
  intro: {
    nav: 'Intro', title: 'What is AgriMatch',
    lead: 'Helps farmers sell rice straw, sugarcane and maize residue to buyers instead of burning it',
    points: [
      { icon: '🌾', title: 'Smallholder farmers', text: 'Post residue on LINE. No app to install and free to use.' },
      { icon: '🏭', title: 'Biomass plants', text: 'Post what you buy and see matches by material, form, quantity and distance.' },
      { icon: '🚜', title: 'Balers', text: 'Offer baling services and resell the straw you buy.' },
      { icon: '📍', title: 'Pilot area', text: 'Nakhon Sawan, Uttaradit, Kamphaeng Phet (district pick lists cover only these 3 provinces).' },
    ],
    notes: 'AgriMatch is a matching marketplace, not a payment system. It already runs on AWS. Today: the problem, the fix, the architecture, then try it yourself.',
  },
  problem: {
    nav: 'Problem', title: 'What farmers and plants face',
    lead: 'The real problem is that information does not reach the other side. It is not a lack of demand.',
    points: [
      { icon: '🔥', title: 'Burning is cheapest', text: 'Rice straw, sugarcane and maize residue is burned in the field. The smoke contributes to PM2.5.' },
      { icon: '🗺️', title: 'Residue sits on small plots', text: 'Collectors waste fuel and time searching. Large buyers pick convenient plots, so distant smallholders get no buyer.' },
      { icon: '🏭', title: 'Plants cannot find matching supply', text: 'They need a specific material, form, quantity and time window.', tag: 'From an interview, no document yet: a biomass plant (KPW Energy) uses about 100 t/day at peak and pays about 700–800 THB/t at the gate' },
      { icon: '🚚', title: 'Loose straw is costly to haul', text: 'Baling lets each trip carry more tons.' },
    ],
    calcTitle: 'Example calculation (from assumptions, not measured)',
    calc: 'Transport cost per ton ≈ 2 × 25 THB/km × distance ÷ tons per trip. At 20 km: loose 6 t ≈ 167 THB/t, baled 15 t ≈ 67 THB/t',
    notes: 'Stress that the interview figures and the calculation are assumptions. Real values must be measured in the pilot.',
  },
  solution: {
    nav: 'Solution', title: 'LINE, three roles, matching and offers',
    lead: 'The system matches. People decide.',
    roles: [
      { icon: '🌾', title: 'Farmer (LINE)', text: 'Post step by step or chat with a Thai AI assistant. A photo check is optional.' },
      { icon: '🏭', title: 'Plant (Dashboard)', text: 'Create demands, view matches, send purchase offers.' },
      { icon: '🚜', title: 'Baler (Dashboard)', text: 'Offer baling services, send offers, create resale listings.' },
    ],
    flowTitle: 'Flow',
    flow: ['Farmer posts', 'System matches', 'Bell alerts plant', 'Plant sends offer', 'Farmer accepts in LINE', 'Agreement'],
    points: [
      { icon: '🎯', title: 'Rule-based matching', text: 'Checks material, form, quantity, time window and a hard 80 km cap, then scores. Prices and distances are shown as «estimate».' },
      { icon: '🔔', title: 'Notifications', text: 'Plants see a bell for new matches. After posting, the farmer gets a LINE summary. With no match, the farmer gets tips and keep-open or close buttons.' },
      { icon: '🤝', title: 'Agreements', text: 'An accepted offer creates an agreement and reduces the remaining quantity. It is not a payment or a quality guarantee.' },
    ],
    notes: 'Offers are sent from the Dashboard and accepted in LINE. This flow is covered by automated tests. Confirmation on the hosted site through real LINE is still to be repeated.',
  },
  tech: {
    nav: 'Technical', title: 'Architecture deployed on AWS',
    lead: 'Region ap-southeast-1 (Singapore)',
    labels: {
      users: 'Users', browser: 'Dashboard in browser', line: 'LINE app', oa: 'LINE Official Accounts ×3', express: 'ECS Express Mode (HTTPS + load balancer)',
      appTask: 'App task (1 Fargate task)', nginx: 'nginx :8080', next: 'Next.js :3000', api: 'Express API :4000',
      worker: 'Worker (separate Fargate service)', workerText: 'Events, outbox, matching jobs', db: 'RDS PostgreSQL 16', dbText: 'Not public. Photos stored as bytea',
      bedrock: 'Amazon Bedrock', bedrockText: 'claude-sonnet-5: Thai chat and photo check', linePush: 'LINE Messaging API',
      secrets: 'Secrets Manager', logs: 'CloudWatch Logs', build: 'CodeBuild', ecr: 'ECR', buildTitle: 'Build', runtimeTitle: 'Runtime', supportTitle: 'Support',
    },
    points: [
      { icon: '🔐', title: 'Secrets', text: 'LINE, session and database values live in Secrets Manager and are injected at runtime. They are not in code or the image.' },
      { icon: '🧪', title: 'Data', text: 'The app uses a restricted database role that cannot change the schema. LINE webhooks verify the signature.' },
      { icon: '🧠', title: 'AI fallback', text: 'If Bedrock fails, the farmer is moved to the step-by-step form automatically.' },
    ],
    notes: 'Web and API share one task behind nginx, so cookies stay same-origin. The worker is a separate service. There is one database and no S3 for photos.',
  },
  demo: {
    nav: 'Demo', title: 'Try it yourself', lead: 'Press in and try it. It takes about 2 minutes.',
    cta: 'Try the demo', farmerNote: 'Farmer side: scan the farmer LINE QR on the login page', farmerLink: 'Open farmer QR',
    stepsTitle: 'Demo steps',
    steps: [
      { text: 'Sign in with the plant demo account' },
      { text: 'Create a demand: rice straw, Nakhon Sawan' },
      { text: 'Open «Matches» and check the bell' },
      { text: 'Send a purchase offer to the farmer' },
      { text: 'The farmer accepts in LINE (scan the farmer QR)' },
      { text: 'See the agreement under «Agreements»' },
    ],
    accountTitle: 'Factory account (for judges)', email: 'Email', password: 'Password',
    accountMissing: 'Ask the team for a demo account',
    accountNote: 'This account is limited (it cannot manage members or organization settings) and is reset after judging.',
    limitsTitle: 'Limitations',
    limits: [
      'Pilot sample data. Prices and distances are estimates, not actual buyer prices.',
      'Real buyer participation and route savings from aggregation are not measured yet.',
      'No payments and no carbon credit trading in the MVP.',
      'Carbon credits are a future direction only, requiring T-VER/TGO verification. No credits, buyers or proceeds are promised.',
      'Photo grading is rule and AI assisted, not a trained CNN.',
      'The plant and baler LINE accounts give basic replies only. Use the Dashboard.',
      'Offer → accept → agreement is covered by automated tests, not yet confirmed on the hosted site.',
    ],
    notes: 'Invite judges to press «Try the demo» and read the limitations before closing.',
  },
};

export const COPY: Record<Lang, Copy> = { th, en };
