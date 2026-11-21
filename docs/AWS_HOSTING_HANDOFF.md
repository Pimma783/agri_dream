# AGRIMATCH: AWS hosting handoff to Kiro

อัปเดต 2026-11-19T03:12:28+07:00 — ผู้ใช้อนุญาตใช้เครดิต/งบ AWS Hackathon แล้ว

## พร้อมแล้ว

การ deploy ล่าสุด SUCCESSFUL, app task revision 2 และ WEB_ORIGIN ตรง URL จริงแล้ว; worker 0/0.

เว็บและ API เปิดผ่าน HTTPS: https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws

หน้าเข้าสู่ระบบ: https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws/login

บัญชี AWS `936270099588`, Region `ap-southeast-1`, CLI profile `ai-hackathon-936270099588`.
โครงการ: `/home/iphone/Desktop/Hackathon/agricarbon-match-ai`.

| ส่วน | หลักฐานที่ตรวจจริง |
| --- | --- |
| HTTPS / API / web | TLS ผ่าน, `/healthz` 200, `/login` 200, `/api/me` 401 เมื่อยังไม่เข้าสู่ระบบ |
| LINE 3 บทบาท | คำขอ empty events ที่เซ็นถูกต้อง 200; ไม่มี signature 401 ทุกบทบาท |
| LINE ตรวจจากระบบ LINE | ตั้ง URL ครบและ test webhook สำเร็จ 200 ทั้ง 3 บัญชี; `active=false` |
| RDS migration | migration task STOPPED, exit 0 รวม quantity-ledger-no-truncate |
| สิทธิ์ DB ของแอป | ใช้ `agrimatch_app` ในฐาน `agrimatch`; อ่านได้ แต่ CREATE schema และ TRUNCATE ledger ไม่ได้ |
| Bedrock จาก ECS | Converse จริงด้วย task role ตอบ READY; ไม่ใช้ SSO cache หรือ static key ใน container |
| LINE tokens จาก ECS | GET bot info ผ่านและ Basic ID ตรงครบทั้ง 3 บัญชี |

การทดสอบนี้ยืนยันโฮสต์และการเชื่อมต่อ ยังไม่ได้ยืนยันบทสนทนาซื้อขายจริงทั้งวงจรหรือบัญชีล็อกอินเดโม

## Webhook ที่ตั้งไว้แล้ว

| บทบาท | Basic ID | URL |
| --- | --- | --- |
| เกษตรกร | @642ctpqm | https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws/webhooks/line/farmer |
| โรงงานอัด | @237ozbsh | https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws/webhooks/line/baler |
| โรงงานรับซื้อ | @241sxehz | https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws/webhooks/line/factory |

ยังปิด Use webhook (`active=false`) ทั้ง 3 บัญชี และ worker desired count = 0 เพราะซอร์ส worker ที่ตรวจยังไม่ลงทะเบียน `line_event` handler หากเริ่มทันทีจะเกิด DEAD/NO_HANDLER ห้ามเปิดรับข้อความก่อนเชื่อม handler และทดสอบการประมวลผล/ตอบกลับครบ

## ทรัพยากรที่เปิดใช้งาน

- ECS cluster / Express service: `agrimatch-demo-20261118`.
- เว็บ/API ร่วม nginx ใน Fargate 1 vCPU / 2 GiB; steady state 1 task; worker service `agrimatch-demo-20261118-worker` จอดที่ 0.
- RDS: `agrimatch-demo-20261118`; PostgreSQL 16.15, db.t4g.micro, Single-AZ, encrypted 20 GiB gp3, backup 7 วัน, deletion protection. ไม่มี public endpoint ที่เชื่อมได้จากอินเทอร์เน็ต; รับ 5432 เฉพาะ security group ของแอป.
- DB hostname: `agrimatch-demo-20261118.cxmyug2myqr3.ap-southeast-1.rds.amazonaws.com`; application DB `agrimatch`. ฐานทดสอบในเครื่องยังเป็น `agrimatch_test` ไม่ได้ย้ายฐานทดสอบขึ้น RDS.
- ECR image ที่ deploy: `936270099588.dkr.ecr.ap-southeast-1.amazonaws.com/agrimatch-demo-20261118:cloud-1-01e86ce4c1`. เป็น source snapshot ตอน CodeBuild สร้าง ต้อง build ใหม่เพื่อรวมงานล่าสุดของ Kiro.
- CodeBuild project: `agrimatch-demo-20261118`; source ZIP ประมาณ 300 KB ส่งไป private S3 แล้ว build/push ภายใน AWS.
- Secrets Manager: `agrimatch-demo-20261118/runtime`. ECS ดึง DATABASE_URL, SESSION_SECRET, LINE secrets/tokens จากที่นี่ ค่า hosted แยกจาก `.env` ในเครื่อง. Migration ใช้ owner แยกจาก runtime role.
- CloudWatch logs: `/agrimatch/agrimatch-demo-20261118/app`, `/worker`, `/migrate`, `/verify`; build logs `/aws/codebuild/agrimatch-demo-20261118`; retention 7 วัน.
- Bedrock task role จำกัดสิทธิ์ที่ InvokeModel บน `anthropic.claude-sonnet-5` ใน Singapore ผ่าน permissions boundary. ไม่ใช้ global. หรือ apac.
- การอัปเดต Express ครั้งแรก rollback เพราะ ModifyRule ถูกปฏิเสธ แก้ด้วย policy เฉพาะ listener rule ของ AgriMatch ใน infrastructure role; helper เก็บวิธีทำซ้ำแล้ว.

ค่าที่เปิดใน cloud: `ENABLE_REAL_LINE=true`, `ENABLE_REAL_BEDROCK=true`, `AI_MODE=disabled`, `VISION_ENABLED=false`. เปิด AI/vision เมื่อ conversation wiring พร้อมและผ่านการทดสอบเท่านั้น. Runtime verify เป็นการเรียก Bedrock โดยตรง แยกจาก AI chat feature.

## วิธี deploy งานถัดไป

ทำจาก root ของโครงการ:

```sh
python infra/hosting/aws-runtime.py build
python infra/hosting/aws-runtime.py build-status
```

รอ SUCCEEDED แล้วอ่าน `image_uri` ใน `infra/hosting/state/aws.json`. ใช้ URI นั้นแทน `<image-uri>` ห้ามใช้ tag เก่าหรือเดา URI.

```sh
python infra/hosting/aws-runtime.py register <image-uri>
python infra/hosting/aws-runtime.py migrate
python infra/hosting/aws-runtime.py status
```

รอ Migration STOPPED exit 0 จึงทำ:

```sh
python infra/hosting/aws-runtime.py verify
python infra/hosting/aws-runtime.py publish
python infra/hosting/aws-runtime.py status
python infra/hosting/check-http.py https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws
```

ตรวจ verification task exit 0 และ deployment ล่าสุด SUCCESSFUL ด้วย ไม่ใช้แค่ service ACTIVE เพราะรุ่นเก่าอาจยังทำงานอยู่หลัง rollback. ดู service deployments/events และ CloudWatch logs ของ task ที่ตรงกับงานนั้น.

`publish` จอด worker ที่ 0 ทุกครั้งโดยตั้งใจ ขณะที่ line_event ยังไม่พร้อม. เมื่อ Kiro เชื่อม handler สำเร็จ ให้ปรับขั้นตอนนี้และค่อยอัปเดต worker เป็น task revision ล่าสุด desired count 1 หลัง migration/verification ผ่าน แล้วเปิด Use webhook ใน LINE Developers Console ทั้ง 3 บัญชี. ตรวจ default greeting/auto reply เพื่อไม่ให้ตอบซ้อน และทดสอบด้วยบัญชีเดโมของผู้ใช้.

## งานที่ Kiro ทำต่อ

1. ตรวจงานล่าสุดในโครงการและ build ใหม่; image ปัจจุบันเป็น snapshot ไม่ได้ตามไฟล์ในเครื่องอัตโนมัติ.
2. ลงทะเบียน line_event handler, conversation/AI, notification และ service wiring ที่ยังขาด; เช็ก idempotency และ retry.
3. Seed ข้อมูลสังเคราะห์และบัญชีล็อกอินเดโมด้วยเส้นทาง seed ที่แอปรองรับ; ยังไม่ได้คัดลอกข้อมูลจริงในเครื่องขึ้น RDS.
4. ตรวจ schema migration/สิทธิ์ DML ของ runtime role เมื่อเพิ่มตารางใหม่ ห้ามใช้ owner credential ให้แอปเพียงเพื่อแก้ permission error.
5. ทดสอบธุรกรรมเกษตรกร → ผู้รับซื้อ/โรงงานอัด รวมโพสต์ขายต่อที่ผู้ใช้ตรวจและยืนยันก่อน และ Dashboard ของสองโรงงาน.
6. Deploy งานล่าสุด แล้วจึงเปิด worker/AI/LINE live และทดสอบ end-to-end. งานโฮสต์ไม่ต้องให้ผู้ใช้สมัคร Supabase หรือทำ HTTPS เพิ่ม.

## ไฟล์และค่าลับ

ชุดติดตั้งอยู่ `infra/hosting/`; อ่าน README.md สำหรับรายละเอียด. Root `.dockerignore` ไม่ส่ง `.env`, dependency cache หรือ hosting private/state เข้า image/source snapshot.

- `infra/hosting/state/aws.json` เก็บ resource IDs และ task revisions เพื่อทำงานต่อ; ไม่ commit.
- `infra/hosting/private/` เก็บค่าลับเริ่มต้น; สิทธิ์ folder 0700/ไฟล์ 0600; ไม่คัดลอกลงเอกสารหรือ commit.
- `.env` ในเครื่องยังเป็น config สำหรับพัฒนา ไม่ต้องเปลี่ยนเป็น hosted DATABASE_URL. การแก้ secret บน AWS ต้อง restart/deploy tasks เพื่อโหลดค่าใหม่.
- ใช้ `configure-line.py` เฉพาะเมื่อต้องตั้ง URL ใหม่และ webhook ปิดอยู่; script ไม่เปิด live traffic.

บริการมีค่าใช้จ่ายต่อเนื่องตามบัญชีที่ผู้ใช้อนุญาตไว้ ไม่มีการตั้งลบอัตโนมัติ; หากปิดงานเดโมให้ผู้ใช้สั่งหยุด/ลบและเก็บ snapshot ฐานข้อมูลก่อน.
