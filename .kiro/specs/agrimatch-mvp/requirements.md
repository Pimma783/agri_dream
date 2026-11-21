# Requirements Document

## Introduction

เอกสารนี้แปลง `docs/AGRIMATCH_MVP_SPEC.md` (v1.0, 18 พ.ย. 2026) เป็นข้อกำหนดแบบ EARS ที่ทดสอบได้ สำหรับระบบ Agrimatch: ผู้ช่วย AI ผ่าน LINE OA 3 บัญชี และ Dashboard ที่เชื่อมเกษตรกร โรงงานอัด และโรงงานรับซื้อ เพื่อลงขายวัสดุเหลือใช้ทางการเกษตร จับคู่ ส่งข้อเสนอ และบันทึกข้อตกลงรับซื้อหรือบริการอัดในระบบ

**ขอบเขตการสร้าง (ตามที่ผู้ใช้ตัดสินใจ):** สร้างตาม stack เต็มของสเปก ได้แก่ Next.js, Node.js/Express, TypeScript, PostgreSQL, Amazon Bedrock Converse API, LINE OA 3 บัญชี และ S3 แบบ private ในตำแหน่งใหม่ (`apps/web`, `apps/api`) โดยไม่แก้เดโม Python เดิม (`webapp.py`, `lot_planning.py`, `lot_service.py`, `web/`, `agent.py`)

**ข้อจำกัดด้านเวลา (ระบุตามจริง):** ผู้ใช้ต้องการให้เสร็จก่อน 21 พ.ย. 2026 (เหลือประมาณ 3 วันนับจาก 18 พ.ย.) แต่แผนในสเปกเองกำหนด 6 วัน และระบุว่าไม่ใช่การรับประกันก่อนสำรวจบัญชีจริง เอกสารนี้จึงไม่ถือว่าทุกข้อทำเสร็จทันกำหนด ส่วน "Priority และเส้นตัดงาน" ด้านล่างแบ่งข้อกำหนดเป็น P0/P1/P2 พร้อมลำดับตัดงานที่ชัดเจน และส่วน "Blockers และสิ่งที่ต้องมีก่อน" แยกสิ่งที่ยังไม่ยืนยันออกจากข้อเท็จจริง

**หลักการที่ยึดจาก Steering:** ไม่รวมการชำระเงินและการซื้อขายคาร์บอนเครดิต; ตัวเลขที่เป็นการประมาณต้องติดป้ายว่าเป็นการประมาณ และแยกจากราคาจริงของผู้ซื้อ; ไม่ใช้ข้อมูลส่วนบุคคลจริงใน fixture; งาน AWS ใช้ ap-southeast-1 และโมเดล `anthropic.claude-sonnet-5` เท่านั้น ห้ามใช้ model ID ที่ขึ้นต้นด้วย `global.` หรือ `apac.`; ห้ามเปลี่ยนหรือลบทรัพยากรในบัญชี AWS ของทีมโดยไม่ถามก่อน

## Glossary

- **Agrimatch_API**: แอป Node.js/Express/TypeScript ฝั่ง Backend ที่เป็นเจ้าของ business service, การตรวจสิทธิ์ และการเปลี่ยนสถานะทั้งหมด
- **Worker**: process เบื้องหลังที่ใช้ฐานโค้ดเดียวกับ Agrimatch_API และอ่านตารางงานใน PostgreSQL เพื่อประมวลผล AI และส่งการแจ้งเตือน
- **Dashboard**: เว็บแอป Next.js สำหรับโรงงานอัดและโรงงานรับซื้อ
- **Line_Gateway**: โมดูลที่รับ webhook จาก LINE OA และส่งข้อความออกผ่านบัญชีที่ถูกต้อง
- **Role**: บทบาทหนึ่งใน `FARMER`, `BALER` (โรงงานอัด), `BUYER_FACTORY` (โรงงานรับซื้อปลายทาง)
- **Channel**: LINE OA หนึ่งบัญชี มี 3 ช่อง ได้แก่ farmer, baler, factory แต่ละช่องมี channel secret และ access token แยกกัน
- **Assistant**: ผู้ช่วย AI ที่เรียก Amazon Bedrock Runtime Converse API ผ่าน Bedrock_Adapter
- **Bedrock_Adapter**: โมดูลที่เรียก Bedrock, บังคับขีดจำกัด token/timeout/retry และอ่าน model ID จาก configuration
- **Draft**: ร่างประกาศ ความต้องการซื้อ บริการอัด คำขออัด หรือประกาศขายต่อ ที่ยังไม่เผยแพร่ มี `version`
- **Listing**: ประกาศขายวัสดุหนึ่งรายการ ผูกวัสดุหนึ่งชนิดและหนึ่งตำแหน่ง (`material_listings`)
- **Demand**: ความต้องการรับซื้อ (`purchase_demands`) ของโรงงานอัดหรือโรงงานรับซื้อ
- **Baling_Service**: ประกาศรับจ้างอัดของโรงงานอัด (`baling_services`)
- **Baling_Request**: คำขอรับบริการอัดของเกษตรกร (`baling_requests`)
- **Matching_Engine**: โมดูลคัดกรองและจัดอันดับคู่ตามกติกาที่ตรวจสอบได้ ใน Agrimatch_API
- **Match**: ผลจับคู่หนึ่งรายการ เก็บคะแนนรายองค์ประกอบ ข้อมูลที่ขาด และ `rule_version`
- **Offer**: ข้อเสนอที่ส่งระหว่างคู่ค้า มี `version` และสถานะ `PENDING`, `ACCEPTED`, `REJECTED`, `WITHDRAWN`, `EXPIRED`
- **Agreement**: ข้อตกลงที่ยืนยันแล้ว ประเภท `PURCHASE` (สถานะ `PURCHASE_CONFIRMED`) หรือ `BALING_SERVICE` (สถานะ `SERVICE_CONFIRMED`)
- **Resale_Allocation**: การจัดสรรปริมาณจาก Agreement ซื้อเข้าไปยังร่างหรือประกาศขายต่อ
- **Outbox**: ตาราง `notification_outbox` ที่เก็บข้อความรอส่งพร้อมสถานะและจำนวน retry
- **Image_Assessor**: โมดูลที่ส่งภาพให้ Bedrock vision model เพื่อประเมินเบื้องต้น
- **Media_Store**: S3 bucket แบบ private ใน ap-southeast-1 สำหรับภาพ
- **Remaining_Quantity**: ปริมาณคงเหลือของ Listing หรือ Demand หลังหักปริมาณใน Agreement ที่ยืนยันแล้ว หน่วยกิโลกรัม
- **Rule_Version**: รหัสเวอร์ชันของกติกาและน้ำหนักคะแนนที่ใช้คำนวณ Match
- **P0 / P1 / P2**: ระดับความสำคัญสำหรับกำหนดส่ง 21 พ.ย. 2026 ตามหัวข้อ "Priority และเส้นตัดงาน"

## Requirements

### Requirement 1: ตัวตน องค์กร และสิทธิ์ตามบทบาท

**User Story:** As a ผู้ดูแลระบบ, I want ให้ Backend ตรวจสิทธิ์ทุกการกระทำตามบทบาทและองค์กร, so that ผู้ใช้เห็นและทำได้เฉพาะสิ่งที่มีสิทธิ์

**Priority:** P0

#### Acceptance Criteria

1. THE Agrimatch_API SHALL ตรวจ Role, การเป็นสมาชิกองค์กร และความเป็นเจ้าของข้อมูลในทุก endpoint และทุกการกระทำของ Assistant ก่อนอ่านหรือเขียนข้อมูล
2. THE Agrimatch_API SHALL อนุญาตความสามารถตามตารางสิทธิ์ของสเปกหัวข้อ 4: ลงขายวัสดุ (FARMER, BALER), ตั้ง Demand (BALER, BUYER_FACTORY), ประกาศ Baling_Service (BALER), ส่ง Baling_Request (FARMER), สร้างร่างขายต่อ (BALER)
3. IF ผู้ใช้ที่ไม่มีสิทธิ์ตามตารางสิทธิ์เรียกการกระทำใด, THEN THE Agrimatch_API SHALL ปฏิเสธด้วยรหัสสถานะ 403 และไม่เปลี่ยนข้อมูล
4. IF ผู้ใช้ขอข้อมูลขององค์กรที่ผู้ใช้ไม่ได้เป็นสมาชิก, THEN THE Agrimatch_API SHALL ตอบ 403 หรือ 404 และไม่เปิดเผยว่าข้อมูลนั้นมีอยู่
5. WHEN ผู้ใช้เพิ่มเพื่อน LINE OA, THE Agrimatch_API SHALL ไม่ให้สิทธิ์จัดการองค์กรจนกว่าการผูกสมาชิกกับองค์กรจะสำเร็จ
6. WHERE ผู้ใช้หนึ่งคนมีหลาย Role, THE Agrimatch_API SHALL ใช้ Role และองค์กรของ Channel หรือ session ปัจจุบันเท่านั้นในการตัดสินสิทธิ์
7. THE Agrimatch_API SHALL รับ Role และองค์กรจาก session หรือ Channel ที่ตรวจแล้ว และไม่เชื่อค่าที่ client ส่งมาเพียงอย่างเดียว

### Requirement 2: รับ webhook จาก LINE OA 3 บัญชี

**User Story:** As a เกษตรกรหรือโรงงาน, I want ให้ข้อความของฉันถึงระบบอย่างถูกบัญชีและไม่ถูกประมวลผลซ้ำ, so that บทสนทนาและข้อมูลไม่ปนกันระหว่างบทบาท

**Priority:** P0

#### Acceptance Criteria

1. THE Line_Gateway SHALL เปิด endpoint แยกกัน `/webhooks/line/farmer`, `/webhooks/line/baler` และ `/webhooks/line/factory` โดยแต่ละ endpoint ใช้ channel secret และ access token ของบัญชีตนเอง
2. WHEN ได้รับ webhook, THE Line_Gateway SHALL ตรวจลายเซ็น `x-line-signature` กับ raw body ก่อน parse JSON
3. IF ลายเซ็นไม่ถูกต้องหรือไม่มี, THEN THE Line_Gateway SHALL ตอบ 401 หรือ 403 และไม่บันทึกหรือประมวลผล event
4. WHEN ลายเซ็นถูกต้อง, THE Line_Gateway SHALL บันทึก event ลง `webhook_events` และสร้างงานใน `jobs` ก่อนตอบ 200 และไม่เรียก Bedrock ในรอบ request นั้น
5. WHEN ได้รับ event ที่มี channel ID และ webhook event ID ซ้ำกับที่บันทึกไว้, THE Line_Gateway SHALL ตอบ 200 และไม่สร้างงานซ้ำ
6. THE Line_Gateway SHALL กำหนด Role เริ่มต้นจาก Channel ที่ตรวจลายเซ็นแล้ว
7. THE Line_Gateway SHALL เก็บ provider ID, channel ID และ LINE user ID ใน `line_identities` และไม่รวมผู้ใช้จากชื่อแสดงผล
8. THE Line_Gateway SHALL ส่งข้อความตอบกลับผ่าน access token ของ Channel ที่รับข้อความนั้นเท่านั้น
9. WHEN Worker ประมวลผลงานล้มเหลวชั่วคราว, THE Worker SHALL ทำซ้ำตามจำนวนครั้งและช่วงเวลาที่กำหนดใน configuration และคงงานไว้ในตารางเมื่อ process รีสตาร์ต

### Requirement 3: ผูก LINE กับองค์กรและเข้าสู่ Dashboard

**User Story:** As a ผู้ใช้โรงงาน, I want ผูกบัญชี LINE กับองค์กรของฉันและเข้า Dashboard อย่างปลอดภัย, so that เฉพาะสมาชิกที่ได้รับเชิญจัดการข้อมูลโรงงานได้

**Priority:** P0 (การผูกด้วยรหัสและ login), P1 (หน้าจัดการสมาชิก)

#### Acceptance Criteria

1. WHEN สมาชิกองค์กรที่ล็อกอินแล้วขอรหัสผูก LINE, THE Agrimatch_API SHALL ออกรหัสใช้ครั้งเดียวที่มีอายุสั้นตามค่า configuration และผูกกับองค์กรและ Role นั้น
2. WHEN ผู้ใช้ส่งรหัสผูกใน Channel ของ Role ที่ตรงกัน, THE Agrimatch_API SHALL ผูก `line_identities` กับสมาชิกองค์กรและทำให้รหัสใช้ซ้ำไม่ได้
3. IF รหัสผูกหมดอายุ ถูกใช้แล้ว ไม่ถูกต้อง หรือส่งใน Channel ของ Role อื่น, THEN THE Agrimatch_API SHALL ปฏิเสธการผูกและไม่เปลี่ยนข้อมูลสมาชิก
4. THE Agrimatch_API SHALL ไม่ถือว่าการรู้ชื่อองค์กรหรืออีเมลทำให้ผู้ใช้เป็นสมาชิกองค์กร
5. WHEN สมาชิกที่ได้รับเชิญล็อกอินด้วยอีเมลและรหัสผ่าน, THE Agrimatch_API SHALL ตรวจรหัสผ่านกับค่า hash และออก session ใน cookie first-party แบบ HttpOnly, SameSite=Lax และ Secure เมื่อรันแบบ production
6. THE Agrimatch_API SHALL ป้องกัน CSRF สำหรับคำขอที่เปลี่ยนข้อมูลซึ่งใช้ session cookie
7. THE Agrimatch_API SHALL เก็บรหัสผ่านเป็น hash เท่านั้นและไม่บันทึกรหัสผ่านหรือรหัสผูก LINE ใน log
8. THE Dashboard SHALL เรียก Agrimatch_API ผ่านเส้นทาง same-origin `/api/*` ที่ Next.js ส่งต่อไปยัง Agrimatch_API เพื่อให้ session cookie เป็น first-party และไม่ต้องตั้งค่า cookie ข้ามไซต์

### Requirement 4: ผู้ช่วย AI ผ่าน Amazon Bedrock

**User Story:** As a ผู้ใช้ทุกบทบาท, I want คุยกับผู้ช่วยที่เข้าใจเจตนาและถามข้อมูลที่ขาดทีละเรื่อง, so that ลงข้อมูลได้โดยไม่ต้องกรอกฟอร์มยาว

**Priority:** P0

#### Acceptance Criteria

1. WHEN Worker ประมวลผลข้อความของผู้ใช้, THE Assistant SHALL โหลดเฉพาะข้อมูลที่ผู้ใช้มีสิทธิ์ ส่งบริบทให้ Bedrock ผ่าน Converse API และจำแนกเจตนาเป็นหนึ่งใน: ขายวัสดุ หาผู้รับอัด ตั้งรับซื้อ ประกาศรับจ้างอัด ขายต่อ ดูสถานะ สอบถามทั่วไป
2. THE Bedrock_Adapter SHALL เรียก Bedrock ใน region `ap-southeast-1` ด้วย model ID จาก configuration ที่มีค่าเริ่มต้น `anthropic.claude-sonnet-5` และไม่ฝัง model ID ใน business logic
3. IF model ID ใน configuration ขึ้นต้นด้วย `global.` หรือ `apac.`, THEN THE Bedrock_Adapter SHALL ปฏิเสธการเริ่มระบบด้วยข้อผิดพลาดที่ระบุค่าที่ไม่อนุญาต
4. THE Bedrock_Adapter SHALL บังคับขีดจำกัด max tokens, timeout และจำนวน retry ที่ระบุใน configuration ทุกครั้งที่เรียก
5. WHEN Assistant ได้ผลลัพธ์ข้อมูลโครงสร้างจาก Bedrock, THE Assistant SHALL ตรวจด้วย schema (Zod), ตรวจหน่วยและสิทธิ์ก่อนบันทึกเป็น Draft
6. IF ผลลัพธ์จาก Bedrock ไม่ผ่าน schema หรือมีตัวเลขหรือวันที่กำกวม, THEN THE Assistant SHALL ไม่บันทึกค่านั้นลง Draft และถามผู้ใช้ใหม่
7. WHEN ข้อความของผู้ใช้ไม่ระบุว่าเป็นรับจ้างอัดหรือรับซื้อเพื่อขายต่อ, THE Assistant SHALL ถามให้ชัดก่อนสร้าง Draft ของโรงงานอัด
8. THE Assistant SHALL อธิบายผลจับคู่จากคะแนนและข้อมูลที่ Agrimatch_API ส่งให้เท่านั้น และไม่เปลี่ยนคะแนนหรือเพิ่มคู่ค้านอกผลค้นหา
9. IF ไม่มีข้อมูลราคาตลาด ผู้ซื้อ หรือสถานะงานในระบบ, THEN THE Assistant SHALL ตอบว่าไม่ทราบและถามข้อมูลเพิ่ม
10. THE Assistant SHALL ถือข้อความ รูป และคำอธิบายของผู้ใช้เป็นข้อมูล และไม่ทำตามคำสั่งในเนื้อหานั้นที่ขอเปลี่ยนสิทธิ์หรือข้ามขั้นตอน
11. IF Bedrock ใช้งานไม่ได้หรือหมดเวลาหลัง retry, THEN THE Agrimatch_API SHALL ให้ผู้ใช้กรอกต่อผ่านคำถามตามขั้นตอนหรือปุ่มใน LINE และผ่านแบบฟอร์ม Dashboard และยังแสดงผลจับคู่ได้
12. THE Agrimatch_API SHALL จำกัดจำนวนข้อความย้อนหลังที่ส่งให้ Bedrock ตามค่า configuration และใช้สรุปบริบทแทนข้อความที่เกิน (สรุปบริบทเป็น P1)

### Requirement 5: ร่าง การยืนยัน และสถานะประกาศ

**User Story:** As a เจ้าของรายการ, I want ตรวจและยืนยันร่างก่อนเผยแพร่ทุกครั้ง, so that AI ไม่เผยแพร่หรือดำเนินการแทนฉันโดยไม่ได้รับอนุญาต

**Priority:** P0

#### Acceptance Criteria

1. THE Agrimatch_API SHALL ให้ Assistant สร้างและแก้ Draft ได้ แต่ไม่ให้ Assistant เผยแพร่ประกาศ ส่งข้อเสนอ ยืนยันซื้อขาย ยืนยันบริการ หรือยกเลิกข้อตกลง โดยไม่มีการยืนยันของผู้ใช้สำหรับการกระทำนั้น
2. WHEN Draft มีข้อมูลบังคับครบ, THE Agrimatch_API SHALL เปลี่ยนสถานะเป็น `AWAITING_REVIEW` และ Line_Gateway SHALL ส่งสรุปพร้อมปุ่ม "ยืนยันเผยแพร่", "แก้ไข" และ "เก็บร่าง"
3. IF Draft ยังขาดข้อมูลบังคับ, THEN THE Agrimatch_API SHALL ไม่อนุญาตให้เปลี่ยนเป็น `PUBLISHED`
4. WHEN เจ้าของ Draft ยืนยันเผยแพร่ด้วย version ที่ตรงกับ version ปัจจุบัน, THE Agrimatch_API SHALL เปลี่ยนสถานะเป็น `PUBLISHED` และบันทึกใน audit log
5. IF ปุ่มยืนยันมาจากข้อความที่อ้าง version เก่ากว่า version ปัจจุบันของ Draft, THEN THE Agrimatch_API SHALL ปฏิเสธการเผยแพร่และส่งสรุป version ล่าสุดให้ตรวจใหม่
6. WHEN ผู้ใช้หรือ Assistant แก้ข้อมูลสำคัญของ Draft, THE Agrimatch_API SHALL เพิ่ม version และเปลี่ยนสถานะกลับเป็น `DRAFT` หรือ `AWAITING_REVIEW` ที่ต้องยืนยันใหม่
7. THE Agrimatch_API SHALL รองรับการเปลี่ยนสถานะประกาศตาม `DRAFT → AWAITING_REVIEW → PUBLISHED → CLOSED` และ `PAUSED`, `CANCELLED` และปฏิเสธการเปลี่ยนสถานะนอกแผนนี้
8. WHEN ผู้ใช้ยืนยันเผยแพร่ซ้ำสำหรับ Draft ที่เผยแพร่แล้วด้วย version เดิม, THE Agrimatch_API SHALL คืนผลเดิมและไม่สร้างประกาศซ้ำ

### Requirement 6: ข้อมูลประกาศขาย หน่วย และราคา

**User Story:** As a เกษตรกรหรือโรงงานอัด, I want ลงขายวัสดุด้วยหน่วยที่ฉันใช้และข้อมูลที่ไม่ถูกแต่งเอง, so that ผู้ซื้อเห็นข้อมูลตรงกับที่ฉันยืนยัน

**Priority:** P0

#### Acceptance Criteria

1. THE Agrimatch_API SHALL เก็บ Listing หนึ่งรายการต่อวัสดุหนึ่งชนิดและหนึ่งตำแหน่ง และให้ผู้ใช้สร้างรายการแยกเมื่อชนิดหรือสถานที่ต่างกัน
2. THE Agrimatch_API SHALL เก็บปริมาณเป็นกิโลกรัมแบบ decimal และแปลง 1 ตัน เป็น 1,000 กิโลกรัม
3. THE Agrimatch_API SHALL เก็บราคาและยอดเงินเป็นชนิด decimal ที่กำหนด precision และไม่ใช้ floating point
4. THE Agrimatch_API SHALL เก็บเวลาเป็น UTC และ Dashboard SHALL แสดงเวลาเป็น Asia/Bangkok
5. WHERE ผู้ขายระบุ "ต่อรองได้", THE Agrimatch_API SHALL เก็บราคาเป็นสถานะต่อรองได้ที่แยกจากราคา 0
6. THE Agrimatch_API SHALL เก็บพิกัดเฉพาะค่าที่ผู้ใช้ส่งมาเอง และไม่สร้างพิกัดแน่นอนจากชื่อจังหวัดหรืออำเภอ
7. THE Agrimatch_API SHALL เก็บรายการวัสดุเริ่มต้น ฟางข้าว ใบอ้อย ซังข้าวโพด และ "อื่น ๆ" และ SHALL ไม่นำรายการ "อื่น ๆ" ที่ยังไม่ยืนยันประเภทเข้าสู่การจับคู่อัตโนมัติ
8. THE Agrimatch_API SHALL เก็บปริมาณทั้งหมด ปริมาณที่ตกลงขาย และ Remaining_Quantity ของ Listing และรักษา ปริมาณทั้งหมด = ปริมาณที่ตกลงขาย + Remaining_Quantity
9. WHEN Assistant ได้รับปริมาณในหน่วยท้องถิ่น เช่น เกวียน หรือ ไร่, THE Assistant SHALL ถามผู้ใช้เพื่อยืนยันค่าเป็นกิโลกรัมหรือตันก่อนบันทึกลง Draft (ตารางแปลงหน่วยท้องถิ่นเป็นคำถามเปิดข้อ 6 ท้ายเอกสาร)

### Requirement 7: ความต้องการรับซื้อ บริการอัด และคำขออัด

**User Story:** As a โรงงานหรือเกษตรกร, I want ตั้งความต้องการรับซื้อ ประกาศบริการอัด และขอรับบริการอัด, so that ระบบจับคู่ได้ตรงเงื่อนไข

**Priority:** P0

#### Acceptance Criteria

1. THE Agrimatch_API SHALL เก็บ Demand พร้อมองค์กร ประเภทและรูปแบบวัสดุที่รับ ปริมาณเป้าหมาย ปริมาณขั้นต่ำต่อครั้ง ปริมาณที่ยังต้องการ ราคาสูงสุดและหน่วยหรือสถานะขอเจรจา สถานที่รับ รัศมีหรือพื้นที่ที่ยอมรับ ช่วงวันที่ เงื่อนไขคุณภาพ ผู้จัดการขนส่ง และการรับวัสดุที่รอพร้อมหรือรออัด
2. THE Agrimatch_API SHALL ให้ผู้ใช้ Role BALER และ BUYER_FACTORY สร้าง แก้ เปิด และปิด Demand ผ่าน Dashboard และผ่าน LINE ของ Role ตน
3. THE Agrimatch_API SHALL เก็บ Baling_Service พร้อมชนิดวัสดุ รูปแบบการอัด พื้นที่ให้บริการ สถานที่ ปริมาณขั้นต่ำ ราคาต่อหน่วย ผู้รับผิดชอบขนส่ง ช่วงเวลาว่าง และรูปแบบบริการหน้างานหรือที่โรงงาน
4. THE Agrimatch_API SHALL เก็บ Baling_Request พร้อมชนิดวัสดุ ปริมาณ สถานที่ วันที่ และรูปแบบที่ต้องการ คือเครื่องอัดไปหน้างานหรือส่งวัสดุไปอัด
5. THE Agrimatch_API SHALL แยก Demand ประเภทรับซื้อออกจาก Baling_Service ในข้อมูลและในหน้าจอของโรงงานอัด
6. WHEN เกษตรกรขอรับบริการอัด, THE Agrimatch_API SHALL ไม่กำหนดให้บริการอัดเป็นเงื่อนไขก่อนการขาย และเกษตรกร SHALL ขาย Listing โดยตรงได้
7. WHEN Demand ถูกสร้างหรือเงื่อนไขที่ใช้ในการจับคู่เปลี่ยนหลังเผยแพร่, THE Matching_Engine SHALL คำนวณ Match ใหม่สำหรับ Demand นั้น

### Requirement 8: ภาพและการประเมินภาพเบื้องต้น

**User Story:** As a เจ้าของประกาศ, I want แนบภาพและได้ข้อสังเกตเบื้องต้น, so that ผู้ซื้อมีข้อมูลเสริมโดยไม่ถือเป็นผลตรวจคุณภาพ

**Priority:** P0 (อย่างน้อยหนึ่งเส้นทางจริง), P1 (ข้อกำหนดที่เหลือของภาพ)

#### Acceptance Criteria

1. WHEN ผู้ใช้อัปโหลดภาพ, THE Agrimatch_API SHALL ตรวจเจ้าของ ชนิดไฟล์ และขนาดไฟล์ตามค่า configuration ก่อนบันทึกลง Media_Store
2. THE Agrimatch_API SHALL เก็บภาพใน Media_Store แบบ private และให้ URL ภาพที่มีอายุจำกัดหลังตรวจสิทธิ์ผู้ขอเท่านั้น
3. WHEN ภาพถูกอัปโหลด, THE Image_Assessor SHALL ขอผลประเมินจาก Bedrock vision model ใน region `ap-southeast-1` แบบ asynchronous ผ่าน Worker
4. THE Image_Assessor SHALL ให้ผลประเมินที่ประกอบด้วย ประเภทวัสดุที่น่าจะเป็น สี สภาพภายนอก สิ่งเจือปนที่มองเห็น ข้อจำกัด และข้อมูลที่ยังต้องถาม
5. IF ภาพไม่เหมาะสมสำหรับการประเมิน, THEN THE Image_Assessor SHALL บันทึกสถานะ "ประเมินไม่ได้"
6. THE Dashboard และ Line_Gateway SHALL แสดงข้อความ "การประเมินเบื้องต้นจากภาพ ไม่ใช่ผลตรวจคุณภาพจริง" ทุกจุดที่แสดงผลประเมินภาพ
7. THE Image_Assessor SHALL ไม่ให้ผลที่ระบุความชื้นเป็นเปอร์เซ็นต์ ค่าความร้อน เกรดรับรอง หรือการผ่านมาตรฐานโรงงาน
8. IF การประเมินภาพล้มเหลว หรือ Listing ไม่มีภาพ, THEN THE Agrimatch_API SHALL อนุญาตให้ Listing เข้าสู่การเผยแพร่และการจับคู่ตามข้อมูลที่เจ้าของยืนยัน
9. THE Agrimatch_API SHALL เก็บผลประเมินผูกกับภาพ เวลาประเมิน และ model ID ในตาราง `image_assessments` แยกจากข้อมูลที่เจ้าของยืนยัน
10. THE Agrimatch_API SHALL ไม่นำผลประเมินของภาพหนึ่งไปใช้กับภาพอื่นหรือกับวัสดุหลังการแปรรูป

### Requirement 9: กติกาคัดกรองของ Matching Engine

**User Story:** As a ผู้ใช้ทุกบทบาท, I want เห็นเฉพาะคู่ที่ผ่านเงื่อนไขบังคับและรู้ว่าอะไรยังไม่ทราบ, so that ไม่เสียเวลากับคู่ที่เป็นไปไม่ได้และไม่เข้าใจผิดว่าผ่านแล้ว

**Priority:** P0

#### Acceptance Criteria

1. THE Matching_Engine SHALL รองรับการจับคู่ 4 เส้นทาง: (1) Listing ของเกษตรกร กับ Demand ของ BUYER_FACTORY (2) Listing ของเกษตรกร กับ Demand ของ BALER (3) Baling_Request กับ Baling_Service (4) Listing ขายต่อของ BALER กับ Demand ของ BUYER_FACTORY
2. THE Matching_Engine SHALL พิจารณาเฉพาะรายการที่สถานะ `PUBLISHED` เปิดใช้งาน และมี Remaining_Quantity มากกว่า 0
3. THE Matching_Engine SHALL คัดออกคู่ที่ประเภทวัสดุ รูปแบบวัสดุ หรือประเภทธุรกรรมไม่สอดคล้องกัน
4. THE Matching_Engine SHALL คัดออกคู่ที่ Remaining_Quantity ต่ำกว่าปริมาณขั้นต่ำ ที่ช่วงเวลาไม่ซ้อนกัน หรือที่ขัดกับเงื่อนไขพื้นที่
5. THE Matching_Engine SHALL ไม่จับคู่รายการกับองค์กรหรือผู้ใช้เจ้าของเดียวกัน
6. WHERE เงื่อนไขบังคับไม่มีข้อมูลยืนยัน, THE Matching_Engine SHALL คงคู่ไว้ในผลและติดป้าย "ต้องสอบถาม/ตรวจเพิ่ม" แทนการแสดงว่าผ่าน
7. WHEN มีพิกัดทั้งสองฝ่าย, THE Matching_Engine SHALL คำนวณระยะทางด้วยสูตร Haversine และ SHALL ระบุในผลว่าเป็นระยะทางเส้นตรงไม่ใช่ระยะขับรถ
8. WHEN ฝ่ายใดไม่มีพิกัด, THE Matching_Engine SHALL จับคู่จากพื้นที่ที่ผู้ใช้ระบุและไม่ระบุว่าผ่านรัศมีแน่นอน
9. THE Matching_Engine SHALL ไม่สร้างโรงงาน ราคา พิกัด หรือคุณภาพที่ไม่มีในข้อมูลที่เผยแพร่
10. THE Matching_Engine SHALL เปิดเผยในผลจับคู่เฉพาะข้อมูลที่ผู้ขอมีสิทธิ์เห็นตามข้อมูลที่เผยแพร่
11. (ผู้ใช้ยืนยัน 18 พ.ย. 2026) WHEN เส้นทาง 1, 2 หรือ 4 มีพิกัดทั้งสองฝ่ายและระยะทางเส้นตรงเกินเพดานขนส่งใน configuration (ค่าเริ่มต้น 80 กม.), THE Matching_Engine SHALL คัดคู่นั้นออกจากผล และ SHALL ยังคำนวณระยะทางเป็นองค์ประกอบคะแนนสำหรับคู่ที่เหลือ
12. WHEN ผลจับคู่มีพิกัดทั้งสองฝ่าย, THE Matching_Engine SHALL แสดงระยะทางเส้นตรงเป็นกิโลเมตร

### Requirement 10: คะแนนการจับคู่

**User Story:** As a ผู้ใช้ทุกบทบาท, I want เห็นคะแนนรายองค์ประกอบที่อธิบายได้, so that เข้าใจว่าทำไมคู่หนึ่งจึงอยู่อันดับสูงกว่า

**Priority:** P0

#### Acceptance Criteria

1. WHEN คู่ซื้อขาย (เส้นทาง 1, 2, 4) ผ่านกติกาคัดกรอง, THE Matching_Engine SHALL คำนวณคะแนนรวม 0–100 จากองค์ประกอบช่วง 0–1 ด้วยน้ำหนัก ระยะทาง 30% ปริมาณ 25% ราคา 20% ช่วงเวลา 15% ความสอดคล้องเงื่อนไข 10%
2. WHEN คู่บริการอัด (เส้นทาง 3) ผ่านกติกาคัดกรอง, THE Matching_Engine SHALL คำนวณคะแนนรวม 0–100 ด้วยน้ำหนัก พื้นที่บริการ 35% วัสดุและรูปแบบการอัด 25% เวลา 20% ปริมาณ 10% ราคา 10%
3. THE Matching_Engine SHALL อ่านน้ำหนักจาก configuration และบันทึกคะแนนรายองค์ประกอบพร้อม Rule_Version ใน Match
4. IF องค์ประกอบใดไม่มีข้อมูล, THEN THE Matching_Engine SHALL คำนวณเฉพาะองค์ประกอบที่ทราบโดยปรับน้ำหนักให้รวมเป็น 100% และบันทึกสัดส่วนน้ำหนักของข้อมูลที่ใช้
5. WHERE คะแนนคำนวณจากข้อมูลไม่ครบ, THE Matching_Engine SHALL ติดป้าย "ข้อมูลไม่ครบ" และจัดอันดับหลังคู่ที่ยืนยันเงื่อนไขสำคัญครบในกลุ่มเดียวกัน
6. THE Matching_Engine SHALL คืนผลลัพธ์เดิมทุกครั้งสำหรับข้อมูลนำเข้า น้ำหนัก และ Rule_Version เดียวกัน
7. THE Dashboard และ Line_Gateway SHALL แสดงว่าน้ำหนักคะแนนเป็นค่าเริ่มต้นสำหรับทดสอบเดโม ไม่ใช่สูตรที่พิสูจน์ว่าดีที่สุด
8. IF ราคาของฝ่ายหนึ่งเป็นสถานะต่อรองได้, THEN THE Matching_Engine SHALL ถือองค์ประกอบราคาเป็นไม่มีข้อมูล และไม่ถือเป็นราคา 0

### Requirement 11: ข้อเสนอและสถานะข้อเสนอ

**User Story:** As a คู่ค้า, I want ส่งและตอบข้อเสนอที่มีเงื่อนไขชัดเจน, so that ทั้งสองฝ่ายตกลงเงื่อนไขเดียวกัน

**Priority:** P0

#### Acceptance Criteria

1. THE Agrimatch_API SHALL เก็บ Offer พร้อมผู้ส่ง ผู้รับ รายการอ้างอิง ประเภทธุรกรรม ปริมาณ ราคาและหน่วย ยอดรวมเมื่อคำนวณได้ เงื่อนไขขนส่ง วันที่พร้อม วันหมดอายุ และ version
2. WHERE ราคาขนส่งยังไม่ทราบ, THE Agrimatch_API SHALL แสดงราคาขนส่งแยกจากยอดรวม และไม่รวมเป็นต้นทุนสุดท้ายที่ยืนยันแล้ว
3. THE Agrimatch_API SHALL รองรับการเปลี่ยนสถานะ Offer ตาม `PENDING → ACCEPTED | REJECTED | WITHDRAWN | EXPIRED` และปฏิเสธการเปลี่ยนสถานะอื่น
4. WHEN ผู้ใช้ยืนยันการส่ง Offer ผ่านปุ่มหรือ Dashboard, THE Agrimatch_API SHALL สร้าง Offer สถานะ `PENDING` ในนามผู้ส่งที่ผ่านการตรวจสิทธิ์
5. THE Agrimatch_API SHALL ไม่ถือการกด "สนใจ" หรือการมีผลจับคู่เป็นการรับซื้อ
6. WHEN ผู้ส่งแก้เงื่อนไขของ Offer, THE Agrimatch_API SHALL เปลี่ยน Offer เดิมเป็น `WITHDRAWN` และสร้าง Offer ใหม่ และ SHALL ไม่แก้เงื่อนไขของ Offer ที่ `ACCEPTED` แล้ว
7. WHEN วันหมดอายุของ Offer ผ่านไป, THE Agrimatch_API SHALL เปลี่ยนสถานะ `PENDING` เป็น `EXPIRED` และไม่ให้รับ
8. IF ผู้ใช้ตอบรับหรือปฏิเสธ Offer ที่ไม่ใช่สถานะ `PENDING`, THEN THE Agrimatch_API SHALL ปฏิเสธการกระทำนั้นและแจ้งสถานะปัจจุบัน
9. THE Line_Gateway SHALL แสดง Offer ให้ผู้รับพร้อมปริมาณ ราคา หน่วยราคา ผู้รับผิดชอบขนส่ง และปุ่มตอบรับและปฏิเสธ

### Requirement 12: ข้อตกลงรับซื้อและการควบคุมปริมาณ

**User Story:** As a คู่ค้า, I want ให้การรับข้อเสนอสร้างข้อตกลงเดียวและหักปริมาณถูกต้องแม้กดพร้อมกัน, so that ไม่มีการขายเกินปริมาณหรือข้อตกลงซ้ำ

**Priority:** P0

#### Acceptance Criteria

1. WHEN ผู้รับที่มีสิทธิ์ตอบรับ Offer ประเภทซื้อขายที่ผู้ส่งเป็นเจ้าของวัสดุ, THE Agrimatch_API SHALL สร้าง Agreement `PURCHASE_CONFIRMED` เมื่อการตรวจในข้อ 3 ผ่าน
2. WHEN โรงงานเป็นผู้ส่ง Offer ซื้อ, THE Agrimatch_API SHALL สร้าง Agreement เมื่อเจ้าของวัสดุเป็นผู้ตอบรับ
3. WHEN ผู้ใช้ตอบรับ Offer, THE Agrimatch_API SHALL ตรวจ version ของรายการอ้างอิง วันหมดอายุ Remaining_Quantity ที่เพียงพอ และสิทธิ์ของผู้ตอบรับอีกครั้งภายใน transaction เดียวกับการสร้าง Agreement
4. WHEN Agrimatch_API สร้าง Agreement, THE Agrimatch_API SHALL หัก Remaining_Quantity ของ Listing และ Demand และเพิ่มข้อความใน Outbox ภายใน transaction เดียวกับการสร้าง Agreement
5. THE Agrimatch_API SHALL ล็อกแถว Listing และ Demand ที่เกี่ยวข้องระหว่างการตอบรับ เพื่อให้ผลรวมปริมาณใน Agreement ที่ยืนยันแล้วของรายการหนึ่งไม่เกินปริมาณทั้งหมดของรายการนั้น
6. WHILE Offer อยู่ในสถานะ `PENDING`, THE Agrimatch_API SHALL ไม่หักหรือจอง Remaining_Quantity
7. IF ผู้ใช้สองคนตอบรับ Offer หลายรายการที่รวมปริมาณเกิน Remaining_Quantity พร้อมกัน, THEN THE Agrimatch_API SHALL ยืนยันเฉพาะรายการที่ปริมาณยังพอและปฏิเสธการตอบรับรายการที่เหลือด้วยรหัส 409 `INSUFFICIENT_QUANTITY` โดย Offer นั้นคงสถานะ `PENDING` (ผู้ใช้ยืนยัน 18 พ.ย. 2026)
8. WHEN ผู้ใช้กดตอบรับซ้ำสำหรับ Offer ที่ `ACCEPTED` แล้ว หรือ Line_Gateway ส่ง webhook ซ้ำ, THE Agrimatch_API SHALL คืน Agreement เดิมและไม่สร้างข้อตกลงหรือหักปริมาณซ้ำ
9. WHEN ปริมาณของ Agreement น้อยกว่า Remaining_Quantity ของ Listing, THE Agrimatch_API SHALL ให้ Listing คงเปิดด้วย Remaining_Quantity ที่เหลือ และเมื่อ Remaining_Quantity เป็น 0 SHALL เปลี่ยนสถานะ Listing เป็น `CLOSED`
10. THE Agrimatch_API SHALL ใช้สถานะ `PURCHASE_CONFIRMED` เป็นจุดสิ้นสุดของรายการซื้อขายใน MVP และไม่ตั้งชื่อสถานะว่าส่งมอบแล้วหรือชำระแล้ว
11. THE Dashboard และ Line_Gateway SHALL แสดงให้ทั้งสองฝ่ายเห็น Agreement เดียวกันและ Remaining_Quantity ที่ถูกต้อง พร้อมข้อความว่าการรับซื้อในระบบหมายถึงการยืนยันข้อตกลง ไม่ใช่หลักฐานการชำระเงิน การส่งมอบ หรือการตรวจคุณภาพ

### Requirement 13: ข้อตกลงบริการอัด

**User Story:** As a เกษตรกร, I want จ้างโรงงานอัดโดยยังเป็นเจ้าของวัสดุ, so that บริการอัดไม่ถูกปนกับการขายวัสดุ

**Priority:** P0

#### Acceptance Criteria

1. WHEN ผู้รับตอบรับ Offer ประเภทบริการอัดหนึ่งครั้ง (ไม่ว่าผู้ส่งเป็นโรงงานอัดหรือเกษตรกร และรวมถึง Offer ที่เกี่ยวข้องกับเกษตรกรหลายราย), THE Agrimatch_API SHALL สร้าง Agreement ประเภท `BALING_SERVICE` สถานะ `SERVICE_CONFIRMED`
2. THE Agrimatch_API SHALL ไม่เปลี่ยนเจ้าของวัสดุ ไม่สร้างรายการซื้อเข้า และไม่หักปริมาณ Listing หรือ Demand เมื่อสร้าง Agreement ประเภท `BALING_SERVICE`
3. THE Agrimatch_API SHALL เก็บ Agreement ประเภท `BALING_SERVICE` แยกจาก Agreement ประเภท `PURCHASE` ในข้อมูลและในหน้าจอ
4. THE Agrimatch_API SHALL ไม่ติดตามงานอัดจนเสร็จใน MVP และไม่ตั้งชื่อสถานะว่าอัดเสร็จแล้ว
5. WHEN ผู้ใช้กดยืนยันบริการซ้ำ, THE Agrimatch_API SHALL คืน Agreement เดิมและไม่สร้างซ้ำ

### Requirement 14: ขายต่อโดยโรงงานอัด

**User Story:** As a โรงงานอัด, I want สร้างร่างประกาศขายต่อทันทีหลังซื้อเข้า, so that ขายต่อให้โรงงานปลายทางได้โดยปริมาณและที่มาตรวจสอบย้อนได้

**Priority:** P0 (สร้างร่าง จัดสรรปริมาณ เผยแพร่ จับคู่ ข้อตกลงปลายทางที่เชื่อมต้นทาง), P1 (การจัดการเมื่อรายการต้นทางถูกยกเลิก)

#### Acceptance Criteria

1. WHEN Agreement `PURCHASE_CONFIRMED` ที่ผู้ซื้อเป็นองค์กร BALER ถูกสร้าง, THE Dashboard และ Line_Gateway SHALL แสดงปุ่ม "สร้างประกาศขายต่อ"
2. WHEN โรงงานอัดกดสร้างประกาศขายต่อ, THE Agrimatch_API SHALL สร้างเฉพาะ Draft และ Assistant SHALL เติมประเภทวัสดุ ปริมาณที่ตกลงซื้อ และรหัส Agreement ต้นทาง
3. THE Assistant SHALL ถามโรงงานอัดเพิ่มสำหรับ ปริมาณขายต่อ สภาพหลังอัด รูปแบบก้อน ราคาขาย สถานที่ และวันที่พร้อมส่ง
4. IF ผู้ใช้ที่ไม่ใช่องค์กรผู้ซื้อของ Agreement หรือไม่ใช่ BALER เรียกสร้างร่างขายต่อ, THEN THE Agrimatch_API SHALL ปฏิเสธด้วย 403
5. THE Agrimatch_API SHALL รักษาผลรวมของ Resale_Allocation ที่ยังใช้งานจาก Agreement หนึ่งไม่ให้เกินปริมาณของ Agreement นั้น และ SHALL ตรวจใหม่เมื่อแก้ปริมาณ
6. WHILE วัสดุยังไม่ได้รับหรือยังไม่ได้อัดจริง, THE Agrimatch_API SHALL บังคับให้ประกาศขายต่อแสดงสถานะ "รอรับ/รออัด" และวันที่คาดว่าจะพร้อม
7. THE Agrimatch_API SHALL ไม่เปลี่ยนสถานะเป็นรับของแล้วหรืออัดเสร็จแล้วโดยอัตโนมัติจากการมี Agreement `PURCHASE_CONFIRMED`
8. THE Agrimatch_API SHALL ไม่แสดงภาพหรือผลประเมินของวัสดุก่อนอัดเป็นหลักฐานคุณภาพหลังอัด และ SHALL ระบุแหล่งที่มาและช่วงเวลาหากแสดง
9. THE Agrimatch_API SHALL เก็บสถานที่ต้นทางแยกจากสถานที่ขายต่อ และไม่คัดลอกข้อมูลติดต่อส่วนบุคคลของเกษตรกรไปยังประกาศขายต่อหรือผู้ซื้อปลายทาง
10. WHEN โรงงานอัดยืนยันเผยแพร่ประกาศขายต่อ, THE Matching_Engine SHALL จับคู่ประกาศนั้นกับ Demand ของ BUYER_FACTORY ตามเส้นทาง 4
11. THE Agrimatch_API SHALL แสดงสถานะ "รอรับ/รออัด" ใน Offer ของประกาศขายต่อ และ SHALL ให้ผู้ซื้อปลายทางยอมรับเงื่อนไขนั้นก่อนยืนยัน
12. WHEN โรงงานปลายทางตกลงรับซื้อประกาศขายต่อ, THE Agrimatch_API SHALL สร้าง Agreement ใหม่ที่อ้างอิง Agreement ต้นทางผ่าน Resale_Allocation
13. WHEN Agreement ต้นทางถูกยกเลิก, THE Agrimatch_API SHALL เปลี่ยนสถานะประกาศขายต่อที่พึ่งพาเป็น `PAUSED` เปลี่ยน Agreement ปลายทางที่ยืนยันแล้วเป็นสถานะ "ต้องทบทวน" และเพิ่มการแจ้งผู้เกี่ยวข้องใน Outbox โดยไม่ลบข้อมูล

### Requirement 15: การแจ้งเตือนและ Outbox

**User Story:** As a คู่ค้า, I want ได้รับแจ้งเมื่อมีข้อเสนอหรือข้อตกลง และไม่เสียข้อมูลเมื่อส่งข้อความล้มเหลว, so that ธุรกรรมยังถูกต้องและเปิดดูภายหลังได้

**Priority:** P0

#### Acceptance Criteria

1. WHEN Offer ถูกสร้าง ถูกตอบรับ ถูกปฏิเสธ หมดอายุ หรือ Agreement ถูกสร้าง, THE Agrimatch_API SHALL เพิ่มข้อความใน Outbox สำหรับผู้เกี่ยวข้องพร้อม Channel ปลายทาง
2. THE Worker SHALL ส่งข้อความจาก Outbox ผ่าน Channel ที่ตรงกับ Role ของผู้รับ และบันทึกสถานะส่งสำเร็จหรือล้มเหลวและจำนวน retry
3. IF การส่งข้อความล้มเหลว, THEN THE Worker SHALL ทำซ้ำตามขีดจำกัด retry ใน configuration และ SHALL ไม่เปลี่ยนสถานะ Offer หรือ Agreement
4. IF การส่งข้อความล้มเหลวหลังครบ retry, THEN THE Worker SHALL ตั้งสถานะ Outbox เป็นล้มเหลวถาวร และ Agreement SHALL ยังเปิดดูได้จากเมนู LINE และ Dashboard
5. THE Worker SHALL ตรวจข้อจำกัดการส่งข้อความของ LINE และไม่ส่งซ้ำข้อความ Outbox รายการเดียวกันที่สถานะส่งสำเร็จแล้ว

### Requirement 16: Dashboard และเมนู LINE

**User Story:** As a ผู้ใช้โรงงาน, I want จัดการความต้องการ ผลจับคู่ และข้อเสนอทั้งใน LINE และ Dashboard, so that ใช้ช่องทางที่สะดวกโดยเห็นข้อมูลตรงกัน

**Priority:** P0 (ฟอร์ม Demand/Baling_Service ผลจับคู่ ข้อเสนอและข้อตกลง ประกาศขายต่อ), P1 (ภาพรวม ตั้งค่าองค์กร ผู้ช่วย AI บน Dashboard เมนู LINE แบบ rich menu), P2 (แผนที่ Leaflet ตัวกรองและสถิติขั้นสูง)

#### Acceptance Criteria

1. THE Dashboard SHALL เรียก business service ชุดเดียวกับ Line_Gateway ผ่าน Agrimatch_API เพื่อให้ LINE และ Dashboard เห็นสถานะตรงกัน
2. THE Dashboard SHALL ให้โรงงานทั้งสองประเภทสร้าง แก้ เปิด และปิด Demand ผ่านฟอร์ม
3. WHERE Role เป็น BALER, THE Dashboard SHALL แสดงส่วนประกาศรับจ้างอัด รายการซื้อเข้า และประกาศขายต่อเพิ่มเติม
4. THE Dashboard SHALL แสดงผลจับคู่พร้อมรายการวัสดุ เหตุผล คะแนนรายองค์ประกอบ และข้อมูลที่ยังขาด
5. THE Dashboard SHALL แสดงข้อเสนอและข้อตกลง ให้ส่งข้อเสนอ ตอบรับ และดูประวัติ
6. WHERE ผู้ช่วย AI บน Dashboard ถูกเปิดใช้, THE Assistant SHALL ใช้สิทธิ์และข้อมูลชุดเดียวกับ LINE
7. THE Dashboard SHALL ใช้งานได้บนจอมือถือความกว้าง 360 พิกเซลโดยไม่ต้องเลื่อนแนวนอนเพื่ออ่านเนื้อหาหลัก
8. THE Line_Gateway SHALL ให้เมนูหลักตามบทบาทตามหัวข้อ 5.1–5.3 ของสเปก โดยเมนูที่ยังไม่พร้อมต้องไม่แสดงเป็นใช้งานได้ (rich menu เป็น P1; ก่อนนั้นใช้ข้อความและ quick reply)
9. WHEN เกษตรกรใช้ LINE เพื่อลงขายและตอบรับข้อเสนอ, THE Agrimatch_API SHALL ให้ทำครบวงจรโดยไม่ต้องเปิดเว็บไซต์

### Requirement 17: ความปลอดภัย ความเป็นส่วนตัว และการตรวจสอบย้อนหลัง

**User Story:** As a ผู้ดูแลระบบ, I want ให้ความลับ ภาพ และข้อมูลติดต่อได้รับการป้องกัน และการกระทำสำคัญถูกบันทึก, so that ตรวจสอบและลดความเสี่ยงรั่วไหลได้

**Priority:** P0

#### Acceptance Criteria

1. THE Agrimatch_API SHALL เก็บ channel secret, access token, ค่า session และ `DATABASE_URL` ฝั่ง server เท่านั้น และ SHALL ไม่ส่งไปยัง frontend
2. THE Agrimatch_API SHALL ไม่เก็บค่าลับจริงใน repository และไฟล์ตัวอย่าง environment SHALL มีเฉพาะค่าสมมติ
3. THE Agrimatch_API SHALL บันทึก audit log สำหรับการเผยแพร่ ส่ง ตอบรับ ปฏิเสธ ถอน ยืนยัน และยกเลิก พร้อมผู้กระทำ การกระทำ entity version และเวลา
4. THE Agrimatch_API SHALL ไม่เขียนข้อความส่วนตัว ค่าลับ หรือข้อมูลติดต่อลง log เกินที่จำเป็น
5. THE Agrimatch_API SHALL ไม่เปิดข้อมูลติดต่อของผู้ใช้ให้คู่ค้าจนกว่าสิทธิ์ตามข้อมูลที่เผยแพร่และความยินยอมอนุญาต
6. THE Agrimatch_API SHALL ใช้ role หรือ temporary credentials ของ AWS ตามที่ hosting รองรับ จำกัดสิทธิ์เฉพาะงานที่ใช้ และ SHALL ไม่ฝังคีย์ AWS ในโค้ดหรือส่งให้ frontend
7. THE Agrimatch_API SHALL ใช้คำสั่ง SQL แบบ parameterized และตรวจ input ที่ขอบเขต trust ทุกจุด
8. THE Agrimatch_API SHALL ไม่ลบหรือเปลี่ยนทรัพยากรในบัญชี AWS ของทีมโดยไม่มีการอนุมัติของผู้ใช้

### Requirement 18: ข้อมูลเดโม การทดสอบ และเกณฑ์ตรวจรับ

**User Story:** As a ทีมพัฒนา, I want ข้อมูลเดโมที่รันซ้ำได้และการทดสอบที่ครอบคลุมกติกาสำคัญ, so that ตรวจรับตามสเปกหัวข้อ 17 ได้อย่างเชื่อถือได้

**Priority:** P0

#### Acceptance Criteria

1. THE Agrimatch_API SHALL มี seed script ที่รันซ้ำได้และสร้างเกษตรกรอย่างน้อย 2 ราย โรงงานอัด 1 แห่ง และโรงงานปลายทาง 2 แห่ง พร้อม Listing และ Demand ที่ตรงและไม่ตรงเงื่อนไข
2. THE Agrimatch_API SHALL ติดป้ายข้อมูลเดโมทุกรายการและไม่ใช้ชื่อ เบอร์โทร ที่อยู่ หรือ LINE user ID จริงใน seed และ fixture
3. THE ชุดทดสอบ SHALL มีการทดสอบอัตโนมัติสำหรับ: การจับคู่และการแปลงหน่วย สิทธิ์ข้ามองค์กร transaction ปริมาณ การรับ Offer ซ้ำและพร้อมกัน การจัดสรรขายต่อ การตรวจลายเซ็น webhook และผล AI ที่ไม่ผ่าน schema
4. THE ชุดทดสอบ SHALL ครอบคลุมสถานการณ์: ขายตรง จ้างอัด ซื้อเข้าแล้วขายต่อ การปฏิเสธข้อเสนอ ราคาไม่ตรง ไม่มีพิกัด ปริมาณบางส่วน และการยืนยัน Draft version เก่า
5. THE ผลการตรวจรับ SHALL ระบุเป็นรายข้อของ acceptance checklist ในหัวข้อ 17 ของสเปก ว่าผ่านด้วยการเชื่อมต่อจริง ผ่านด้วย mock หรือยังไม่ได้ทำ และ SHALL ไม่รายงานการเชื่อมต่อที่ใช้ mock ว่าเสร็จจริง
6. WHERE การเชื่อมต่อภายนอก (LINE, Bedrock, S3) ยังไม่พร้อม, THE ทีมพัฒนา SHALL ใช้ fake หรือ mock ระหว่างพัฒนาและทดสอบ (PostgreSQL ใช้ Docker local) และ SHALL บันทึกเป็น blocker ในผลตรวจรับ
7. THE Agrimatch_API SHALL มี adapter จริงของ LINE (ตรวจลายเซ็นและส่งข้อความ), Bedrock Converse และ S3 ที่เขียนไว้ครบหลัง port เดียวกับ fake และ SHALL ปิดไว้ด้วย flag `ENABLE_REAL_LINE`, `ENABLE_REAL_BEDROCK`, `ENABLE_REAL_S3` (ค่าเริ่มต้น false) จนกว่าผู้ใช้ใส่ credentials
8. THE ทีมพัฒนา SHALL ไม่สร้างหรือแก้ทรัพยากร AWS หรือ LINE ใด ๆ และ SHALL ส่งมอบ `docs/HANDOVER.md` ที่ระบุรายการที่ผู้ใช้ต้องเชื่อมต่อเองและตารางสถานะว่าอะไรผ่านด้วย fake และอะไรยังไม่ได้ตรวจกับของจริง

### Requirement 19: ขอบเขตที่ไม่รวมและการติดป้ายประมาณการ

**User Story:** As a เจ้าของผลิตภัณฑ์, I want ให้ MVP ไม่รวมสิ่งที่นอกขอบเขตและติดป้ายตัวเลขที่เป็นประมาณการ, so that ผู้ใช้ไม่เข้าใจผิดว่ามีการชำระเงิน ส่งมอบ หรือคาร์บอนเครดิตที่ยืนยันแล้ว

**Priority:** P0

#### Acceptance Criteria

1. THE Agrimatch_API SHALL ไม่มีฟังก์ชันชำระเงิน escrow การติดตามขนส่ง การติดตามงานอัด เกรดคุณภาพรับรอง ราคาตลาดสด หรือการซื้อขายหรือคำนวณคาร์บอนเครดิตใน MVP
2. THE Dashboard และ Line_Gateway SHALL ติดป้ายตัวเลขที่เป็นการประมาณหรือที่คำนวณโดยระบบว่าเป็นการประมาณ และแยกจากราคาที่ผู้ซื้อเสนอจริง
3. THE Assistant SHALL ไม่รับประกันว่าผู้ซื้อจะเข้าร่วม ไม่รับประกันรายได้ และไม่อ้างคาร์บอนเครดิตที่ยืนยันแล้ว
4. THE Agrimatch_API SHALL ไม่แสดงสถานะ Agreement ว่าชำระแล้ว ส่งมอบแล้ว หรือผ่านการตรวจคุณภาพ

## Priority และเส้นตัดงาน

ส่วนนี้ไม่ใช่ข้อกำหนดแบบ EARS แต่เป็นข้อตกลงการจัดลำดับสำหรับกำหนด 21 พ.ย. 2026

**ความจริงเรื่องเวลา:** สเปกวางแผน 6 วัน ผู้ใช้ต้องการให้เสร็จใน ~3 วัน ระบบนี้ครอบคลุม LINE 3 บัญชี Bedrock S3 PostgreSQL Matching 4 เส้นทาง และ transaction ทั้งหมด จึงมีความเสี่ยงสูงที่ P0 บางข้อจะไม่เสร็จทัน และ P0 ทุกข้อที่พึ่งบริการภายนอกขึ้นกับ blocker ในหัวข้อถัดไป ผลรายงานต้องระบุข้อที่ไม่เสร็จตามจริง

### P0 — ต้องสาธิตได้ภายใน 21 พ.ย.

เรื่องราวเดโม 3 เรื่อง: (1) ขายตรง (2) จ้างอัด (3) ซื้อเข้าแล้วขายต่อ พร้อมสิ่งต่อไปนี้

| กลุ่ม | Requirement | ขอบเขต P0 |
| --- | --- | --- |
| สิทธิ์ | 1, 3 | ตรวจสิทธิ์ที่ Backend, login Dashboard, ผูก LINE ด้วยรหัสใช้ครั้งเดียว |
| LINE | 2 | webhook 3 Channel พร้อมลายเซ็นและกันซ้ำ (ใช้งานจริงขึ้นกับ blocker B1, B2) |
| AI | 4, 5 | Converse API, ถามข้อมูลที่ขาด, ร่าง และการยืนยันก่อนเผยแพร่, fallback เมื่อ AI ล้มเหลว (ขึ้นกับ B3) |
| ข้อมูล | 6, 7 | Listing, Demand, Baling_Service, Baling_Request พร้อมหน่วยและ decimal |
| ภาพ | 8 | อย่างน้อยหนึ่งเส้นทางประเมินภาพจริง และกรณีล้มเหลวไม่ขวางการขาย (ขึ้นกับ B3, B4) |
| จับคู่ | 9, 10 | 4 เส้นทาง, เหตุผล, คะแนนรายองค์ประกอบ, ข้อมูลไม่ครบ |
| ธุรกรรม | 11, 12, 13 | Offer, Agreement, ควบคุมปริมาณ, idempotency, บริการอัดแยกจากซื้อขาย |
| ขายต่อ | 14.1–14.12 | สร้างร่าง จัดสรรปริมาณ เผยแพร่ จับคู่ ข้อตกลงปลายทางที่เชื่อมต้นทาง |
| แจ้งเตือน | 15 | Outbox ใน transaction และ Worker พร้อม retry |
| หน้าจอ | 16.1–16.5, 16.9 | ฟอร์ม Demand/Baling_Service, ผลจับคู่, ข้อเสนอและข้อตกลง |
| ความปลอดภัย | 17, 19 | ความลับ audit log ขอบเขตที่ไม่รวม |
| ตรวจรับ | 18 | seed ข้อมูลเดโม ชุดทดสอบกติกาสำคัญ รายงานตรวจรับตามจริง |

**เส้นที่ห้ามตัด (safety floor):** การตรวจสิทธิ์ที่ Backend, การยืนยันของมนุษย์ก่อนเผยแพร่และก่อนยืนยันธุรกรรม, ควบคุมปริมาณและ idempotency, ตรวจลายเซ็น webhook, ป้ายการประเมินภาพ และการไม่รายงานว่า mock คือการเชื่อมต่อจริง

### P1 — ทำถ้ามีเวลา

- Dashboard ภาพรวม หน้าตั้งค่าองค์กร หน้าจัดการสมาชิก และผู้ช่วย AI บน Dashboard (3.x บางส่วน, 16.3 บางส่วน, 16.6)
- Rich menu และ Flex Message แทนข้อความและ quick reply (16.8)
- สรุปบริบทสนทนา (4.12)
- ข้อกำหนดภาพส่วนที่เกินหนึ่งเส้นทางจริง (8.x ที่เหลือ)
- จัดการเมื่อ Agreement ต้นทางของขายต่อถูกยกเลิก (14.13)

### P2 — หลัง MVP

แผนที่ Leaflet ตัวกรองและสถิติขั้นสูง รวมถึงรายการ "หลัง MVP" ของสเปกหัวข้อ 15 (ชำระเงิน/escrow ติดตามขนส่งและงานอัด เอกสารการค้า เกรดรับรอง เทรนโมเดล ราคาตลาดสด คาร์บอนเครดิต แอปมือถือ หลายผู้ดูแลต่อองค์กรขั้นสูง คงคลังเต็มรูปแบบ)

### ลำดับตัดงานเมื่อ P0 ไม่ครบ

ตัดตามลำดับนี้ โดยเริ่มจากข้อ 1 และตัดข้อต่อไปเมื่อยังไม่ทัน:

1. ทุกข้อ P1 และ P2
2. การประเมินภาพ: ลดเหลือเส้นทางเดียวที่ใช้ได้จริง (เกษตรกรส่งภาพผ่าน LINE) และตัดการประเมินภาพของ Role อื่น
3. เมนู LINE ของโรงงานรับซื้อ: ใช้ Dashboard เป็นช่องทางหลักของ BUYER_FACTORY และเก็บ LINE สำหรับแจ้งเตือนและตอบรับข้อเสนอเท่านั้น
4. เรื่องราวที่ 2 (จ้างอัด) ใช้เส้นทาง Dashboard ฝั่งผู้ให้บริการ และตัดการสร้าง Baling_Request ผ่านบทสนทนา AI ให้เหลือปุ่มและคำถามตามขั้นตอน
5. เรื่องราวที่ 3 (ขายต่อ): ตัดสุดท้ายในกลุ่ม P0 เพราะพึ่งเรื่องราวที่ 1 และมีกติกาซับซ้อนที่สุด ถ้าตัดต้องรายงานว่าข้อตกลงปลายทางของขายต่อยังไม่ได้ทำ

เรื่องราวที่ 1 (ขายตรง) พร้อมการควบคุมปริมาณ สิทธิ์ และการยืนยันร่างเป็นขั้นต่ำที่ต้องเสร็จเป็นอันดับแรก ข้อใดที่ตัดต้องบันทึกใน Requirement 18.5

## Blockers และสิ่งที่ต้องมีก่อน

ตารางนี้แยกสิ่งที่ยังไม่ได้รับการยืนยันออกจากข้อเท็จจริง ณ วันที่เขียน ยังไม่มีการตรวจว่ารายการใดพร้อมแล้ว

| รหัส | ต้องมี | ใช้กับ | วิธียืนยัน | ถ้าไม่มี |
| --- | --- | --- | --- | --- |
| B1 | LINE Developers channel (Messaging API) 3 ช่อง พร้อม channel secret และ channel access token แยกกัน | Req 2, 3, 15, 16 | ส่งข้อความทดสอบถึง webhook ของแต่ละช่องและเห็น event ที่ลายเซ็นถูกต้อง | พัฒนา webhook ด้วย payload จำลองที่ลงลายเซ็นเองได้ แต่ห้ามรายงานว่าเชื่อม LINE จริงแล้ว และ acceptance ข้อที่เกี่ยวกับ OA ไม่ผ่าน |
| B2 | URL HTTPS สาธารณะสำหรับ webhook (เช่น Railway หรือ tunnel) | Req 2 | LINE Console กด Verify ผ่าน | ทดสอบได้เฉพาะ local ด้วยการเรียกตรง ไม่ผ่านข้อตรวจรับที่ต้องใช้ OA จริง |
| B3 | สิทธิ์ AWS เข้าถึง Bedrock ใน `ap-southeast-1` และเปิดโมเดล `anthropic.claude-sonnet-5` (ห้าม `global.`/`apac.`; บัญชีทีมจำกัด ap-southeast-1, ap-southeast-7, us-east-1) ต้องยืนยันด้วย AWS MCP และ skill ก่อนทำงาน AWS และต้องยืนยันว่าโมเดลรองรับภาพ | Req 4, 8 | เรียก Converse ด้วยข้อความและภาพตัวอย่างสำเร็จ (ตรวจด้วย `check_bedrock.py` หรือ AWS MCP) | ใช้ fallback ตามข้อ 4.11 และ mock Bedrock เฉพาะการพัฒนา UI; การประเมินภาพจริงและ AI conversation จริงนับว่ายังไม่เสร็จ |
| B4 | S3 bucket แบบ private ใน `ap-southeast-1` | Req 8 | อัปโหลดและขอ URL ที่มีอายุจำกัดได้ | การสร้าง bucket เป็นการเปลี่ยนบัญชีทีม ต้องถามผู้ใช้ก่อน; ระหว่างนี้ใช้ที่เก็บ local เฉพาะ dev และนับว่าภาพจริงยังไม่เสร็จ |
| B5 | PostgreSQL ที่ใช้ได้ (docker local ใช้ได้ตามผู้ใช้; Railway ยังไม่ยืนยัน) | ทุก Requirement | รัน migration และ seed สำเร็จ | ไม่มีทางเลี่ยง ต้องมีอย่างน้อย local; ไม่ใช้ SQLite แทนเพราะ transaction และ lock ต้องตรงกับเป้าหมาย |
| B6 | ที่ host ที่รัน Next.js และ Express ภายใต้ origin สาธารณะเดียวกัน (Next.js ส่งต่อ `/api/*` ไปยัง Express; ยังไม่ยืนยันว่าใช้ Vercel/Railway หรืออื่น) ไม่ต้องใช้โดเมนเดียวกันข้ามบริการอีกต่อไป เพราะ cookie เป็น first-party | ส่งมอบ ลิงก์ Dashboard และ API สาธารณะ (webhook LINE ใช้ URL สาธารณะของ API เอง) | deploy แล้วล็อกอินผ่าน Dashboard และเห็น cookie `agrimatch_sid` เป็น first-party | เดโมรัน local ผ่าน proxy `localhost` และบันทึกข้อจำกัด; ไม่รายงานว่า deploy แล้ว (ผู้ใช้เป็นผู้เชื่อมต่อ ดู `docs/HANDOVER.md`) |
| B7 | บัญชีทดสอบ LINE จริงของผู้ใช้ 3 บทบาท | การตรวจรับ Req 18 | ผู้ทดสอบเพิ่มเพื่อนและส่งข้อความได้ | ตรวจรับเส้นทางบทสนทนาจริงไม่ได้ นับเป็นยังไม่ผ่าน |
| B8 | การสำรวจโค้ดและบัญชีในวันแรก (สเปกระบุว่ายังไม่ยืนยันว่ามีโค้ด ฐานข้อมูล หรือ LINE OA ใดพร้อม) | แผน | บันทึกผลสำรวจใน `docs/handoff.md` | แผนเวลาไม่น่าเชื่อถือ |

กติกาเมื่อ blocker ยังไม่ปลดล็อก: ใช้ fake/mock ในการพัฒนาและทดสอบ บันทึก blocker ที่ชัดเจน และห้ามรายงานว่าการเชื่อมต่อจริงเสร็จแล้ว

**ผู้ใช้เป็นผู้เชื่อมต่อบริการภายนอกเอง (ยืนยัน 18 พ.ย. 2026):** LINE LIFF ฝั่งผู้ใช้ตั้งค่าไว้แล้ว (สเปกนี้ไม่ใช้ LIFF) ส่วน LINE OA 3 ช่อง (secret/token), URL HTTPS สาธารณะ, AWS/Bedrock, S3 และ hosting ผู้ใช้จะเชื่อมต่อเองภายหลัง AI สร้างทุกอย่างที่ทำได้โดยไม่ต้องใช้ของจริง (adapter จริงปิดด้วย flag) แล้วส่งรายการส่งมอบใน `docs/HANDOVER.md` B1–B4, B6, B7 จึงยังเป็น "ยังไม่ได้เชื่อมต่อ" จนกว่าผู้ใช้ยืนยัน

## Confirmed by user (18 Nov 2026)

ผู้ใช้ตัดสินใจแล้ว รายการเหล่านี้ไม่ใช่ข้อสมมติรอยืนยันอีกต่อไป (รหัส A คือรหัสในส่วน assumptions ของ `design.md`)

- **การรับ Offer (Q1/A8):** ผู้รับตอบรับหนึ่งครั้งทำให้ Offer สำเร็จ ใช้กติกาง่ายนี้กับทุกกรณี รวมถึง Offer บริการอัดที่ BALER เป็นผู้ส่ง และ Offer ที่เกี่ยวข้องกับเกษตรกรหลายราย ไม่มีการยืนยันรอบที่สอง (ปิดคำถามเปิดข้อ 10; ปรับ Requirement 13.1)
- **ปริมาณไม่พอตอนตอบรับ (Q2/A9):** Offer คงสถานะ `PENDING` และการตอบรับได้ 409 `INSUFFICIENT_QUANTITY` (Requirement 12.7)
- **เพดาน 80 กม. (Q5/A1):** เป็นตัวกรองคัดออกแบบเด็ดขาดสำหรับเส้นทาง 1, 2, 4 และยังคิดระยะทางเป็นคะแนน (ปิดคำถามเปิดข้อ 1; Requirement 9.11)
- **Session cookie:** Dashboard และ API ใช้ origin เดียวกัน Next.js ส่งต่อ `/api/*` ไปยัง Express cookie เป็น first-party (Requirement 3.5, 3.8; B6)
- **LINE LIFF:** ผู้ใช้ตั้งค่า LIFF ไว้แล้ว แต่สเปกนี้ไม่ใช้ LIFF (A2) ผู้ใช้จะให้ credentials ของ LINE OA 3 ช่องเอง
- **บริการภายนอก:** ผู้ใช้เชื่อมต่อ LINE, AWS/Bedrock, S3 และ hosting เองภายหลัง AI สร้าง adapter จริงที่ปิดด้วย flag, ทดสอบด้วย fake และ Docker Postgres, ไม่แตะทรัพยากรจริง และส่งมอบ `docs/HANDOVER.md` (Requirement 18.6–18.8)

**ใช้ค่าเริ่มต้น (ยังไม่มีคำตอบ):** Q3/A7 สร้างองค์กร FARMER ส่วนตัวอัตโนมัติเมื่อเกษตรกรเพิ่มเพื่อน Q4 ผู้อนุมัติและเจ้าของ S3/IAM ผู้ใช้ยังไม่ทราบ ใช้วิธีเขียน IaC (CDK/CloudFormation) ให้ผู้ใช้ตรวจและ deploy เอง ไม่ deploy เอง เป็นรายการส่งมอบ

## คำถามเปิดและข้อขัดแย้งที่พบ

รายการนี้บันทึกจุดที่สเปกขัดกับ Steering หรือยังไม่ชัด ข้อ 1 และ 10 ปิดแล้วตามหัวข้อ "Confirmed by user" ข้อ 8 ปิดบางส่วน (วิธี credentials ยังเป็นรายการส่งมอบ)

1. **(ปิดแล้ว: เป็นตัวกรองเด็ดขาด 80 กม. และยังให้คะแนน) ระยะขนส่ง 80 กม.:** `steering/product.md` กำหนดจำกัดระยะขนส่ง 80 กม. และสเปก F3 เดิมตัดคู่ที่เกิน 80 กม. แต่สเปก Agrimatch ใช้ระยะทางเป็นคะแนน 30% และไม่มีค่าตัดขาด ใช้ 80 กม. เป็นเงื่อนไขคัดกรองเมื่อมีพิกัด เป็นเพดานของ Demand ที่ผู้ซื้อกำหนดเอง หรือเป็นเพียงคะแนน? Requirement 9.11 รอคำตอบ
2. **Python กับ TypeScript:** `steering/tech.md` ระบุตรรกะจับคู่เป็น Python (`matching/`) แต่สเปกกำหนด TypeScript ใน Backend เดียวและไม่มี Python Matching Service ข้อกำหนดนี้ยึดสเปก (TypeScript) ต้องยืนยันและควรอัปเดต steering
3. **Redis, PostGIS, JWT:** `tech.md` วางแผน Redis, PostGIS และ JWT แต่สเปกตัด Redis และ PostGIS ออกจาก MVP และใช้ Haversine ในโค้ด และ session/JWT ใน HttpOnly cookie ยึดสเปก
4. **ช่องทางและ PWA:** `product.md` ใช้ LINE Messaging API และ LIFF เป็นช่องหลัก และ PWA ที่ใช้ offline ได้ ส่วนสเปก Agrimatch ใช้ LINE OA 3 บัญชีกับ Dashboard เว็บ ไม่มี LIFF และไม่มีข้อกำหนด offline ข้อกำหนดนี้ไม่รวม LIFF และ offline PWA ต้องยืนยัน
5. **กลุ่มผู้ใช้และรายได้สุทธิ:** `product.md` เน้นการประมาณรายได้สุทธิของเกษตรกรและการรวมกลุ่ม F5 (3–5 ราย ภายใน 10 กม.) สเปก Agrimatch ไม่มีการคำนวณรายได้สุทธิหรือการรวมกลุ่ม และเพิ่มบทบาทโรงงานอัดที่ steering ไม่มี ต้องยืนยันว่าสเปกนี้แทน F3 ของ Bootcamp หรือเป็นผลิตภัณฑ์ต่อยอด
6. **หน่วยท้องถิ่น:** `product.md` ให้รองรับ เกวียน และ ไร่ สเปก Agrimatch กำหนดเฉพาะกิโลกรัมและตัน (1 ตัน = 1,000 กก.) ไม่มีตารางแปลงเกวียนหรือไร่เป็นกิโลกรัมซึ่งต่างกันตามวัสดุ ต้องกำหนดตารางแปลงหรือให้ผู้ใช้ยืนยันค่าทุกครั้ง (Requirement 6.9 เลือกให้ผู้ใช้ยืนยันเป็นค่าชั่วคราว)
7. **Model ID ใน configuration:** สเปกให้ตั้งค่า model ID ผ่าน configuration และตรวจ Region จริง แต่ `aws.md` กำหนด `anthropic.claude-sonnet-5` ใน `ap-southeast-1` และห้าม `global.`/`apac.` Requirement 4.2–4.3 ใช้ทั้งสองข้อ ต้องยืนยันว่า `anthropic.claude-sonnet-5` รับภาพ ถ้าไม่รับ ต้องมีโมเดล vision ตัวที่สองที่อยู่ในกติกาเดียวกัน
8. **(ปิดบางส่วน: IaC ให้ผู้ใช้ตรวจและ deploy เอง) Hosting นอก AWS:** สเปกใช้ Vercel และ Railway แต่ `aws.md` ให้ใช้ IaC (CDK/CloudFormation) สำหรับทรัพยากร AWS และห้ามเปลี่ยนบัญชีทีมโดยไม่ถาม ใครอนุมัติและสร้าง S3 bucket และ IAM role? Credentials จาก Railway ไปยัง AWS จัดการอย่างไร (สเปกให้ใช้ role/temporary credentials ตามที่ hosting รองรับ)
9. **ความขัดกันของกำหนดเวลา:** สเปก 6 วัน เทียบกับกำหนด 21 พ.ย. (~3 วัน) และ `product.md` ระบุว่าทีมจะสร้างเฉพาะ F3 สำหรับ Bootcamp ผู้ใช้ตัดสินใจสร้างเต็ม stack แล้ว ต้องยืนยันว่ายอมรับเส้นตัดงานข้างต้นหรือไม่
10. **(ปิดแล้ว: ผู้รับตอบรับครั้งเดียว) ผู้ขายส่ง Offer:** สเปกข้อ 13.2 ให้ข้อตกลงจบทันทีเมื่อโรงงานรับ Offer ที่ผู้ขายส่ง และต้องให้เจ้าของวัสดุรับเมื่อโรงงานเป็นผู้ส่ง ไม่ได้ระบุกรณีที่ BALER ส่งข้อเสนอจ้างอัดเอง หรือเกษตรกรหลายรายต่อ Offer เดียว ผู้ใช้ยืนยันให้ใช้กติกาง่าย: ผู้รับตอบรับครั้งเดียว (Requirement 13.1)
11. **Resale และรายการต้นทางที่ถูกยกเลิก:** สเปกกำหนดให้ข้อตกลงปลายทางขึ้นสถานะ "ต้องทบทวน" แต่ไม่ระบุว่าใครทบทวนและผลลัพธ์ที่เป็นไปได้ (ยกเลิกหรือยืนยันต่อ) Requirement 14.13 บันทึกเฉพาะสถานะและการแจ้ง
12. **ความยินยอมและข้อมูลส่วนบุคคล:** สเปกกล่าวถึงความยินยอมใน `users` แต่ไม่ระบุข้อความ ระยะเวลาเก็บ และนโยบาย PDPA `tech.md` ระบุว่านโยบายความเป็นส่วนตัวของทีมยังรอยืนยัน Requirement 17.5 ใช้ค่าระมัดระวังชั่วคราว
13. **ค่า configuration ที่ยังไม่ระบุ:** ขนาดไฟล์ภาพสูงสุด ชนิดไฟล์ อายุ URL ภาพ อายุรหัสผูก LINE max tokens timeout จำนวน retry precision ของ decimal และวันหมดอายุเริ่มต้นของ Offer ต้องกำหนดตอนออกแบบ
14. **เมนู LINE:** สเปกให้ rich menu ตามบทบาท แต่การสร้างและผูก rich menu ต่อ OA ใช้เวลาเพิ่ม จึงจัดเป็น P1 ต้องยืนยันว่ารับได้หรือไม่ หากไม่รับ ต้องตัดฟีเจอร์อื่น
