# Agrimatch: verified runtime handoff for Kiro

อัปเดต 18 พฤศจิกายน 2026 (Asia/Bangkok) — เป้าหมายเดโม 21 พฤศจิกายน 2026

โครงการจริง: `/home/iphone/Desktop/Hackathon/agricarbon-match-ai`

## อัปเดตโฮสต์ 19 พฤศจิกายน 2026

โฮสต์ AWS / HTTPS / RDS เปิดแล้ว และตั้ง LINE webhook URLs พร้อมทดสอบ 200 ครบ 3 บทบาท อ่าน `docs/AWS_HOSTING_HANDOFF.md` เป็นสถานะล่าสุด ส่วนด้านล่างเป็นบันทึกก่อน deploy และอาจล้าสมัย. Worker ยังจอดที่ 0 และ LINE live ยังปิดจน line_event handler พร้อม.

## สถานะที่ตรวจจริง (บันทึกเดิมก่อน deploy)

| ส่วน | สถานะ |
| --- | --- |
| PostgreSQL ในเครื่อง | เชื่อมต่อจริงผ่านทั้งสองฐาน; DB tests ล่าสุด 133 ผ่าน / 3 ไม่ผ่าน (ดู DATABASE_CHECK_REPORT.md) |
| Session secret | สุ่มใหม่และเก็บใน `.env` ส่วนตัวแล้ว |
| AWS SSO | ลงชื่อและตรวจ STS บัญชี Hackathon ผ่าน |
| Bedrock ข้อความ | Converse จริง ตอบ READY ผ่าน |
| Bedrock ภาพ | Converse ภาพสีแดงสังเคราะห์ 64×64 ตอบ Red ผ่าน |
| LINE OA / Messaging API | สร้างและเปิดครบ 3 บัญชีใต้ Provider AgriMatch |
| LINE credentials | เก็บ Channel secret + access token ครบ 3 บทบาทใน `.env` และตรวจ bot info API ผ่านทุกบัญชี |
| API/worker ที่เชื่อม LINE จริง | ยังไม่พร้อมในซอร์สที่ตรวจ |
| Cloud hosting / public HTTPS | ยังไม่ได้ deploy และยังไม่มี URL |
| LINE webhook / end-to-end | ยังไม่ได้ตั้ง URL หรือ Verify และยังไม่ทดสอบรับส่งข้อความผ่านแอป |

## LINE: พร้อมสำหรับเชื่อมโค้ด

Provider: AgriMatch / ID `2005679668`

| บทบาท | ชื่อบัญชี | Basic ID | Channel ID | Token check |
| --- | --- | --- | --- | --- |
| farmer | AgriMatch เกษตรกร | @642ctpqm | 2012684575 | ผ่าน |
| baler | AgriMatch โรงงานอัด | @237ozbsh | 2012684482 | ผ่าน |
| factory | AgriMatch รับซื้อ | @241sxehz | 2012684565 | ผ่าน |

ผู้ใช้อนุมัติการสมัครบัญชี ข้อกำหนด LINE OA การใช้ข้อมูล Messaging API และการออกโทเค็นของทั้งสามบัญชีแล้ว ไม่ต้องให้ผู้ใช้สมัครใหม่หรือออกโทเค็นซ้ำ บัญชี AgriMatch และ iPhone เดิมไม่ได้ถูกนำมาเปลี่ยนบทบาท

ตรวจด้วย GET `https://api.line.me/v2/bot/info` โดยใช้โทเค็นจาก `.env`: แต่ละบัญชีตอบ Basic ID และ displayName ตรงกับบทบาท พร้อม chatMode=bot การทดสอบนี้เป็นการอ่านข้อมูลบอท ไม่ได้ส่งข้อความหาใคร

ค่าจริงมีเฉพาะใน `.env` ของโครงการ (สิทธิ์ไฟล์ `0600`, อยู่ใน `.gitignore`):

- `LINE_FARMER_CHANNEL_SECRET`, `LINE_FARMER_ACCESS_TOKEN`
- `LINE_BALER_CHANNEL_SECRET`, `LINE_BALER_ACCESS_TOKEN`
- `LINE_FACTORY_CHANNEL_SECRET`, `LINE_FACTORY_ACCESS_TOKEN`

ห้ามพิมพ์ค่าลับใส่ log, chat, README, รายงาน หรือ commit และห้าม Reissue เพียงเพื่อทดสอบ เพราะจะกระทบค่าที่เตรียมไว้

## PostgreSQL และคำสั่งใช้งาน

สร้าง `.env` แบบส่วนตัว มีรหัส PostgreSQL และ SESSION_SECRET ที่สุ่มใหม่ พร้อม DATABASE_URL และ TEST_DATABASE_URL ที่ตรงกับฐานข้อมูลจริงในเครื่อง

- Container: `agrimatch-postgres` / PostgreSQL 16
- พอร์ต: `127.0.0.1:5433` เปิดเฉพาะเครื่องนี้
- App database: `agrimatch` / Test database: `agrimatch_test`
- Volume ใหม่: `agrimatch-mvp_ops-pgdata`
- Volume เก่า `agrimatch-mvp_agrimatch-pgdata` ถูกเก็บไว้ ไม่ลบหรือเปลี่ยนรหัส
- Override ส่วนตัว: `.env.runtime.compose.yml` โหลดรหัสจาก `.env`
- App migrations: 3 ชุด, public tables 26 ตารางรวม migrations
- DB verification ล่าสุด: 13 test files / 136 tests; 133 ผ่าน, 3 ไม่ผ่าน ดู `docs/DATABASE_CHECK_REPORT.md`

helper โหลด `.env` โดยไม่พิมพ์ค่า ใช้ Node 22 ขึ้นไป และให้ environment ที่ตั้งไว้ก่อนมีลำดับสูงกว่าไฟล์

```sh
node scripts/ops-runtime.mjs db-up
node scripts/ops-runtime.mjs db-status
node scripts/ops-runtime.mjs migrate
node scripts/ops-runtime.mjs test-db
```

เริ่มแต่ละ process ใน terminal แยกเมื่อโค้ดพร้อม:

```sh
node scripts/ops-runtime.mjs api
node scripts/ops-runtime.mjs web
node scripts/ops-runtime.mjs worker
```

helper ระบุ migration direction เป็น up ให้แล้ว อย่าลบ volume หรือ reset เพื่อแก้การเชื่อมต่อ ก่อนหน้านี้พอร์ต 3000/4000 มี process ใช้อยู่ จึงไม่ได้เริ่มทับหรือหยุด process เหล่านั้น

## AWS Bedrock: ผ่าน CLI แล้ว แต่แอปยังต้องเชื่อม adapter

```dotenv
AWS_PROFILE=ai-hackathon-936270099588
AWS_REGION=ap-southeast-1
BEDROCK_MODEL_ID=anthropic.claude-sonnet-5
BEDROCK_VISION_MODEL_ID=anthropic.claude-sonnet-5
```

- AWS CLI 2.40.3 และ STS ผ่านหลังผู้ใช้อนุมัติ SSO
- GetFoundationModel ยืนยัน TEXT / IMAGE และ ON_DEMAND
- Converse ข้อความจริงตอบ READY, stopReason=end_turn
- Converse ภาพสังเคราะห์สีแดง 64×64 ตอบ Red, stopReason=end_turn
- Probe ใช้ maxTokens=128 และปิด thinking ใช้โมเดลตรงใน Singapore ไม่ใช้ global. หรือ apac.
- ไม่สร้าง access key ไม่เปลี่ยน IAM และไม่ใช้ข้อมูลส่วนตัวใน probe

SSO เป็นสิทธิ์ชั่วคราวบนเครื่องนี้ ถ้าหมดอายุให้ต่ออายุ profile เดิม การ deploy ต้องจัด role/temporary credentials ที่โฮสต์ใช้ได้แยกต่างหาก ไม่คัดลอก SSO cache ขึ้นคลาวด์

[เอกสารโมเดล AWS](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html)

## งานที่ Kiro ต้องทำต่อ

ตรวจซอร์สล่าสุดก่อนแก้ เพราะ Kiro กำลังพัฒนาต่ออยู่ ขณะตรวจ `apps/api/src/http/app.ts` ยังมีเฉพาะ health route และคอมเมนต์รอ webhook ส่วน `worker.ts` เป็น keep-alive ที่ยังไม่มี job runner

1. ใช้ DATABASE_URL, SESSION_SECRET และ LINE credentials ที่เตรียมแล้ว ไม่ต้องขอผู้ใช้เตรียมซ้ำ
2. ทำ LINE client/real Bedrock adapter และ service wiring ตาม task เดิม
3. เพิ่ม webhook 3 บทบาท ตรวจ signature จาก raw body ก่อน parse, กัน event ซ้ำ, เก็บงานให้คงทน และตอบรับเร็ว
4. ให้ worker ประมวลผล AI และส่ง notification/outbox โดยใช้โทเค็นตรงกับบทบาท
5. ทดสอบแต่ละ role ผ่านแอปโดยไม่เปิดเผยข้อมูลส่วนตัวหรือส่งข้อความนอกกรณีทดสอบที่ผู้ใช้อนุญาต
6. เตรียมและ deploy API + worker + web พร้อม PostgreSQL ที่โฮสต์เข้าถึงได้
7. เมื่อมี public API HTTPS ที่ใช้งานจริง จึงตั้ง URL ด้านล่างและ Verify ใน LINE Console

```text
https://<public-api-host>/webhooks/line/farmer
https://<public-api-host>/webhooks/line/baler
https://<public-api-host>/webhooks/line/factory
```

DATABASE_URL ในเครื่องไม่ใช่ hosted DATABASE_URL และ localhost ใช้จาก LINE หรือโฮสต์ภายนอกไม่ได้

ยังคง integration flags ตามเดิมไว้จน real adapters และ wiring พร้อม การมี credentials ครบไม่เท่ากับแอปพร้อมรับข้อความจริง ห้ามเปลี่ยนทุก flag เป็น true เพียงเพื่อให้ health ดูพร้อม

ตรวจสถานะ auto-reply ของ OA ก่อนทดสอบจริง เพราะยังไม่ได้ปิดข้อความตอบกลับเริ่มต้นของ LINE อาจซ้อนกับคำตอบจากระบบ

## หลักฐานและขอบเขตส่งมอบ

รายงานที่ไม่มีค่าลับใน outputs ของแชต:

- `BEDROCK_VERIFICATION.json`
- `LINE_ALL_ROLES_VERIFICATION.json`

ส่งมอบ LINE credentials และการยืนยันสิทธิ์ Bedrock ในเครื่องครบแล้ว ส่วน hosting, webhook และ end-to-end ยังไม่เสร็จ ห้ามรายงานว่าผ่านขั้นตอนเหล่านั้นจากผลทดสอบ token หรือ CLI เพียงอย่างเดียว

## ผลตรวจฐานข้อมูลล่าสุดหลัง Kiro เพิ่มงาน

DATABASE_URL และ TEST_DATABASE_URL ปัจจุบันเชื่อมต่อได้และแยก app/test ถูกต้อง ไม่ได้แก้รหัสผ่านโดยไม่จำเป็น รัน `node scripts/ops-runtime.mjs test-db` แล้ว 133 ผ่าน / 3 ไม่ผ่าน เป็น resetData, farmer follow และ outbox DEAD ดู `docs/DATABASE_CHECK_REPORT.md` สำหรับ stack และข้อจำกัดการวิเคราะห์ ไม่ใช่ปัญหาที่ต้องย้ายไป Supabase
