# AGRIMATCH MVP: เอกสารส่งมอบ (HANDOVER)

ข้อมูลในเอกสารนี้มาจากการรันจริงเมื่อ 20 พ.ย. 2026 (Asia/Bangkok) และจากการอ่านไฟล์ใน repo (อ้าง path กำกับ) รายการใดที่ไม่ได้ตรวจ ระบุว่า **ยังไม่ได้ตรวจ** ไม่มีค่าลับในเอกสารนี้ มีเพียงที่เก็บของค่าลับ

## 1) สถานะสรุป

| ส่วน | สถานะ | ตรวจอย่างไร |
| --- | --- | --- |
| Web + API บน AWS (HTTPS) | ใช้งานได้ | `check-http.py` ผ่าน: TLS, health, หน้า login, `/api/me` ตอบ 401 เมื่อไม่ล็อกอิน |
| Webhook 3 บทบาท (`/webhooks/line/farmer\|baler\|factory`) | รับ request ที่เซ็นถูกต้องได้ | `check-http.py`: events ว่างที่เซ็นถูก = 200, ไม่เซ็น = 401 ทั้ง 3 เส้นทาง (ไม่ใช่ข้อความจริงจากแอป LINE) |
| Deploy | สำเร็จ | image `936270099588.dkr.ecr.ap-southeast-1.amazonaws.com/agrimatch-demo-20261118:cloud-2-5eccfcfa64` (CodeBuild `agrimatch-demo-20261118:01923e0f-cf72-4fc8-8854-f0075c1505b6` SUCCEEDED); task definition `app:3` เป็น PRIMARY, 1 task กำลังรัน, deployment ล่าสุด SUCCESSFUL; migrate task STOPPED exit 0; verify task STOPPED exit 0 |
| ข้อมูลเดโม (seed) | มีแล้ว ทำซ้ำได้ | รันครั้งที่ 1: organizations=6 accounts_created=6 published=10 already_present=0 recomputed=10 match_rows=5; ครั้งที่ 2: accounts_created=0 published=0 already_present=10 recomputed=0 match_rows=5 (entity ID เดิม ไม่แก้ข้อมูลเดิม) |
| ล็อกอินบน hosted | ผ่าน | `demo-factory-a`, `demo-factory-b` (BUYER_FACTORY) และ `demo-baler` (BALER) ล็อกอินได้ (204), `/api/me` 200 พร้อม role ถูก, `/api/matches` 200: โรงงาน A 2 รายการ (route 1), โรงงาน B 2 รายการ (route 1), baler 1 รายการ (route 3); response ไม่มี key `phone`/`email`/`line_user_id`/`owner_user_id` |
| LINE ผ่านแอป LINE จริง | **ยังไม่ได้ทดสอบ** | ปิดอยู่ (ดูหัวข้อ 5) |
| Bedrock chat / วิเคราะห์ภาพ | ปิดอยู่ | `AI_MODE=disabled`, `VISION_ENABLED=false` (แชทเกษตรกรใช้เส้นทางถามทีละขั้น) |

หมายเหตุขอบเขตการยืนยัน: ผลทดสอบอัตโนมัติ (หัวข้อ 8) ใช้ fake/mock และ Postgres ในเครื่อง ไม่ใช่การยืนยันกับ LINE หรือ Bedrock จริง ตามกฎใน `.kiro/specs/agrimatch-mvp/tasks.md`

## 2) URL และบัญชีเดโม

- URL: https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws (หน้าเข้าสู่ระบบ `/login`)
- AWS บัญชี `936270099588`, region `ap-southeast-1`, ECS cluster/service `agrimatch-demo-20261118`
- Webhook URL (ตั้งไว้แล้ว, Use webhook ปิด):
  - เกษตรกร `@642ctpqm`: `<URL>/webhooks/line/farmer`
  - ผู้อัดฟาง `@237ozbsh`: `<URL>/webhooks/line/baler`
  - โรงงานรับซื้อ `@241sxehz`: `<URL>/webhooks/line/factory`

| บทบาท | อีเมล | ช่องทางหลัก |
| --- | --- | --- |
| BALER (โรงงานอัดฟาง) | `demo-baler@example.invalid` | Dashboard |
| BUYER_FACTORY ก (อุตรดิตถ์) | `demo-factory-a@example.invalid` | Dashboard |
| BUYER_FACTORY ข (นครสวรรค์) | `demo-factory-b@example.invalid` | Dashboard |

- รหัสผ่านเดโม: ในเครื่องที่ `infra/hosting/private/demo-accounts.json` (สิทธิ์ 0600) และบน AWS Secrets Manager secret `agrimatch-demo-20261118/demo-accounts` (อ่านได้เฉพาะ role `agrimatch-demo-20261118-seed-execution`) ห้ามคัดลอกลงเอกสารหรือแชต
- เกษตรกร (เดโม เกษตรกร A/B/C) **ไม่มี** บัญชี Dashboard สำหรับ seed (`apps/api/scripts/seed-demo.ts` กำหนด login เฉพาะ baler และโรงงาน 2 ราย) เกษตรกรใช้ LINE เท่านั้น
- การตัดสินใจสำหรับเดโม: เกษตรกรใช้ LINE; baler และโรงงานใช้ Dashboard เป็นหลัก; OA ทั้ง 3 ยังคงอยู่

## 3) วิธีสาธิต 3 เรื่องราว

ข้อสำคัญ: เนื่องจาก LINE ยังปิดอยู่ ขั้นตอนฝั่งเกษตรกรใน LINE **สาธิตบน hosted ไม่ได้จนกว่าเจ้าของจะอนุมัติและเปิดตามหัวข้อ 5** ข้อมูลที่ seed แล้วทำให้เห็นผลจับคู่และเสนอข้อเสนอจาก Dashboard ได้ทันที

### เรื่องที่ 1: ขายตรง (route 1: เกษตรกร → โรงงานรับซื้อ)
1. ล็อกอิน `demo-factory-a@example.invalid` ที่ `/login`
2. เมนู «ผลจับคู่» (`/matches`) เห็น 2 รายการ route 1 เปิด `/matches/[id]` ดูเหตุผล คะแนน ข้อมูลที่ขาด และ "ระยะเส้นตรง" (verified บน hosted: `/api/matches` 200)
3. สร้างข้อเสนอ (`/offers/new`) แล้วดู `/offers/[id]`
4. ผู้รับข้อเสนอรับ/ปฏิเสธที่ `/offers/[id]` เมื่อรับแล้วมีข้อตกลงที่ `/agreements/[id]` พร้อมข้อความ "ไม่ใช่การชำระเงิน การส่งมอบ หรือคุณภาพ" และปริมาณคงเหลือ
5. ผลที่คาดหวัง: ข้อตกลง 1 รายการ ปริมาณคงเหลือลดตามที่ตกลง
- สถานะการยืนยัน: ส่วนประกาศ/จับคู่ของเรื่องนี้ยืนยันบน hosted แล้วถึง `/api/matches` เท่านั้น ขั้นสร้าง/รับข้อเสนอผ่านการทดสอบอัตโนมัติ (`e2e-story1.db.test.ts`, mock + Postgres ในเครื่อง) **ยังไม่ได้กดผ่านหน้าเว็บบน hosted**
- ส่วน LINE ของเกษตรกร (ลงประกาศ, รับข้อเสนอ): รหัสอยู่ใน `apps/api/src/channels/line/handlers/farmer.ts`; ทดสอบกับ FakeLineClient เท่านั้น **ไม่ได้ทดสอบในแอป LINE จริง**
- ฝั่งโรงงานทาง LINE: handler ตอบเพียงข้อความ placeholder (งาน 9.10/18.1 ยังไม่เสร็จ) จึงใช้ Dashboard

### เรื่องที่ 2: บริการอัดฟาง (route 3)
1. ล็อกอิน `demo-baler@example.invalid`
2. เมนู «รับจ้างอัด» (`/services`) ดู/สร้างบริการ (`/services/new`) และ «ผลจับคู่» เห็น 1 รายการ route 3 (verified บน hosted: `/api/matches` 200)
3. ส่งข้อเสนอแบบ `BALING_SERVICE` ผู้รับรับข้อเสนอ ได้ข้อตกลงสถานะ `SERVICE_CONFIRMED`
4. ผลที่คาดหวัง: ไม่เปลี่ยนความเป็นเจ้าของและไม่เปลี่ยนปริมาณ
- สถานะการยืนยัน: ขั้นข้อเสนอ/ข้อตกลงผ่านการทดสอบอัตโนมัติ (`baling-story.db.test.ts`) ยังไม่ได้กดบน hosted
- ที่ยังค้าง: การสร้าง baling_request ผ่านแชท (17.1) ยังไม่เสร็จ ให้ใช้ Dashboard

### เรื่องที่ 3: ขายต่อ (route 2 แล้ว route 4)
ข้อมูล seed **ไม่มี** purchase demand ของ BALER ต้องเตรียมก่อน:
1. ล็อกอิน baler → `/demands/new` เลือก "รับซื้อเพื่อขายต่อ" (`?intent=resale`) สร้างและเผยแพร่ purchase demand ให้ตรงวัสดุ/พื้นที่ของประกาศเกษตรกร
2. ต้องมีประกาศเกษตรกรที่จับคู่ได้ (route 2) แล้วส่ง/รับข้อเสนอจนได้ข้อตกลงแบบ `PURCHASE` ที่ baler เป็นผู้ซื้อ (ฝั่งเกษตรกรส่งข้อเสนอผ่าน LINE ซึ่งยังเปิดไม่ได้ ดังนั้นบน hosted ตอนนี้ขั้นนี้ **ยังไม่มีวิธีที่ยืนยันแล้ว**)
3. หน้า `/agreements/[id]` ของ baler มีปุ่ม «สร้างประกาศขายต่อ» (`apps/web/src/components/resale-draft-button.tsx`) เรียก `POST /agreements/:id/resale-draft` (`apps/api/src/http/resale-routes.ts`)
4. **ข้อจำกัด:** ปุ่มพาไป `/resale/[draftId]` แต่ใน `apps/web/src/app` **ไม่มีหน้า `/resale`** (ไม่พบไฟล์ใน `(app)/`) และเมนู «ขายต่อ» ใน `apps/web/src/lib/nav.ts` ตั้ง `ready: false` ดังนั้นการแก้/เผยแพร่ร่างขายต่อทางเว็บทำไม่ได้ (งาน 16.4 ยังไม่เสร็จ; ไม่มีปุ่ม LINE ด้วย)
5. สรุป: **เรื่องที่ 3 ยืนยันระดับ API และการทดสอบอัตโนมัติเท่านั้น** (`resale-draft.db.test.ts`, `resale-publish.db.test.ts`, `e2e-story3.db.test.ts`) บน hosted สาธิตได้สูงสุดถึงการสร้างร่างจากข้อตกลง ไม่ใช่การเผยแพร่ route 4 และการรับของโรงงานปลายทาง
6. เส้นทางที่ไม่ใช้เว็บ: เผยแพร่ผ่าน API ต้องใช้ session + CSRF (`GET /me` ให้ `csrf_secret`) **ยังไม่ได้ตรวจบน hosted**

### งานค้างที่กระทบการสาธิต
ดูหัวข้อ 6 โดยเฉพาะ 9.10/18.1 (LINE ของ baler/factory), 13.3 (รูปจาก LINE), 16.4 (หน้า resale), 17.1

## 4) วิธี deploy ซ้ำ

ทำที่ root ของ repo ใช้ `infra/hosting/aws-runtime.py` (คำสั่งที่มีจริง: `bootstrap`, `database`, `register`, `image`, `build`, `build-status`, `migrate`, `verify`, `seed-setup`, `seed`, `seed-status`, `publish`, `status`) **ต้องได้รับอนุญาตจากเจ้าของก่อนรันทุกครั้ง** เพราะเป็นการเปลี่ยนทรัพยากร AWS

```sh
python infra/hosting/aws-runtime.py build
python infra/hosting/aws-runtime.py build-status      # รอ SUCCEEDED; image_uri อยู่ใน infra/hosting/state/aws.json
python infra/hosting/aws-runtime.py register <image-uri>
python infra/hosting/aws-runtime.py migrate
python infra/hosting/aws-runtime.py status            # รอ Migration: STOPPED exit 0 (ไม่ผ่าน = หยุด ห้ามข้าม)
python infra/hosting/aws-runtime.py verify            # ตรวจ verify task exit 0
python infra/hosting/aws-runtime.py publish
python infra/hosting/aws-runtime.py status
python infra/hosting/aws-runtime.py seed              # ต้องเคย seed-setup แล้ว (ทำแล้วครั้งก่อน) และ register image ใหม่ก่อน
python infra/hosting/aws-runtime.py seed-status       # ดู exit code และบรรทัดสรุปจำนวน (ไม่พิมพ์ค่าลับ)
python infra/hosting/check-http.py https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws
```

วิธีตรวจหลัง deploy:
- deployment ล่าสุดของ service ต้อง SUCCESSFUL (ไม่ดูแค่ ACTIVE เพราะรุ่นเก่าอาจยังรันหลัง rollback), `app` task revision ใหม่เป็น PRIMARY
- `check-http.py` ผ่านทุกข้อ
- seed: ครั้งแรก `accounts_created=6 published=10`; รันซ้ำต้องได้ `already_present=10 recomputed=0` และ entity ID เดิม
- `publish` จอด worker ที่ 0 เสมอ (`infra/hosting/aws-runtime.py` ฟังก์ชัน `publish`)
- ไม่มีคำสั่งลบ/รีเซ็ตใน helper โดยตั้งใจ
- รายละเอียดเพิ่มเติม: `infra/hosting/README.md`, `docs/AWS_HOSTING_HANDOFF.md` (เอกสารนี้ลงวันที่ 19 พ.ย. และบางส่วนล้าสมัย เช่น image รุ่นเก่า)

## 5) ค่าที่ต้องเปิดก่อนใช้ LINE จริง — **ต้องได้รับอนุมัติจากเจ้าของก่อนทุกข้อ**

ตอนนี้ปิดอยู่ทั้งหมด ยังไม่มีการเปิดใด ๆ

1. Worker service `agrimatch-demo-20261118-worker`: ตั้ง desired count เป็น 1 บน task definition revision ล่าสุด (`publish` ตั้ง 0 ทุกครั้ง ต้องปรับด้วยคำสั่ง ECS แยกหรือแก้ helper; **ยังไม่มีคำสั่งใน helper ที่ตั้งเป็น 1**) ในซอร์สปัจจุบัน `apps/api/src/worker.ts` ลงทะเบียน `line_event` แล้ว (`registerLineEvent`) แต่ **ยังไม่ได้ตรวจว่า image `cloud-2-5eccfcfa64` บน hosted ทำงานกับ worker จริง** ถ้าเริ่ม worker โดยไม่มี handler งานจะเป็น DEAD/NO_HANDLER
2. เปิด "Use webhook" ใน LINE Developers Console ทั้ง 3 OA: `@642ctpqm`, `@237ozbsh`, `@241sxehz` (URL ตั้งแล้ว ตรวจด้วย `configure-line.py` ได้ขณะ webhook ปิด สคริปต์ไม่เปิด live traffic)
3. ตรวจและปิด auto-reply / greeting message ของ LINE ในทั้ง 3 OA เพื่อไม่ให้ตอบซ้อน
4. (ไม่บังคับ) `AI_MODE=enabled` หลังทดสอบแล้วเท่านั้น และ `VISION_ENABLED=true` ถ้าต้องการวิเคราะห์ภาพ การแก้ secret/env บน AWS ต้อง register/publish ใหม่ให้ task โหลดค่าใหม่
5. ทดสอบ end-to-end ด้วยบัญชี LINE เดโมของเจ้าของ แล้วบันทึกผล

ชื่อค่าตั้งค่า (ทั้งหมดอยู่ใน `.env.example`; ห้ามใส่ค่าจริงในเอกสาร): `NODE_ENV`, `PORT`, `DATABASE_URL`, `TEST_DATABASE_URL`, `WEB_ORIGIN`, `API_INTERNAL_URL`, `ENABLE_REAL_LINE`, `ENABLE_REAL_BEDROCK`, `AI_MODE`, `ENABLE_REAL_S3` (ไม่ใช้แล้ว: รูปเก็บใน PostgreSQL), `VISION_ENABLED`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_VISION_MODEL_ID`, `LOCAL_MEDIA_DIR` (ไม่ใช้แล้ว), `SESSION_SECRET`, `LINE_{FARMER,BALER,FACTORY}_CHANNEL_SECRET`, `LINE_{FARMER,BALER,FACTORY}_ACCESS_TOKEN`, `MEDIA_URL_TTL_SECONDS`
- ค่าบน hosted เก็บใน Secrets Manager `agrimatch-demo-20261118/runtime` (ไม่ใช่ `.env` ในเครื่อง)
- Bedrock: ใช้ `anthropic.claude-sonnet-5` ใน `ap-southeast-1` เท่านั้น ห้ามรหัสโมเดลที่ขึ้นต้น `global.` หรือ `apac.` (`apps/api/src/config/guards.ts` ปฏิเสธ)
- URL เว็บและ API เป็น origin เดียว: `/api/*` ถูก rewrite โดย Next.js และ nginx ใน container เดียว; `WEB_ORIGIN` ต้องตรง URL จริง
- Smoke test: `python infra/hosting/check-http.py <URL>` (health, signature 200/401); `python infra/hosting/aws-runtime.py verify` (Bedrock 1 ครั้งและ LINE bot info); ในเครื่อง `ENABLE_REAL_BEDROCK=true npx tsx apps/api/scripts/bedrock-smoke.ts --yes` (เรียก Converse 1 ครั้ง, ยังไม่ได้รันในรอบนี้)
- **S3:** งาน 21.2 (ไฟล์ IaC สำหรับ S3/IAM) ยังไม่เสร็จ ไม่มีไฟล์ใน `infra/` (มีแค่ `hosting` และ `postgres`) และรูปเก็บใน PostgreSQL จึงไม่มี S3 put/presign ให้ทดสอบ ผู้ตรวจสอบและผู้อนุมัติ IaC เป็นประเด็นเปิด

## 6) ข้อจำกัดและงานค้าง

งานที่ยังไม่เสร็จ (อ้าง `.kiro/specs/agrimatch-mvp/tasks.md` และ `npm run acceptance:report`):
- 9.10 / 18.1: handler LINE ของ baler/factory ตอบเพียง placeholder
- 13.3: ภาพจาก LINE ของเกษตรกร
- 16.2: property test ของ resale allocation (Property 13)
- 16.4: หน้า Dashboard `/resale`, `/resale/[draftId]` และปุ่ม LINE ขายต่อ
- 17.1: baling_request ผ่านแชท (ยังไม่เสร็จ/ปรับปรุง)
- 19.x, 20.x (P1/P2): ภาพสำหรับ role อื่น, หน้าภาพรวมและตั้งค่าองค์กร, assistant บน Dashboard, rich menu/Flex, สรุปบทสนทนา, จัดการยกเลิกข้อตกลงต้นทาง, แผนที่
- 21.2: ไฟล์ IaC S3/IAM ยังไม่เสร็จ
- 22 (checkpoint สุดท้าย) ยังไม่ปิด

ข้อจำกัดอื่น:
- LINE end-to-end ในแอปจริงยังไม่ได้ทดสอบ; signature ตรวจด้วยทราฟฟิกที่เซ็นเองในเครื่องเท่านั้น
- Bedrock chat/ภาพจริงยังไม่ได้ทดสอบ (ปิดอยู่); `verify` ตรวจ Converse โดยตรงเท่านั้น
- ไม่มี payment และไม่มีการซื้อขายคาร์บอนใน MVP; ราคาและผลตอบแทนเป็นค่าประมาณ น้ำหนักจับคู่เป็นค่าเดโม
- ประเด็นเปิด: นโยบายความเป็นส่วนตัว, LIFF ไม่ได้ใช้, ค่าเริ่มต้นของ `packages/contracts`, ผู้ตรวจ/ผู้อนุมัติ IaC
- Postgres ในเครื่องเคยหยุด 2 ครั้งเพราะเครื่องโฮสต์ปิด (graceful 'fast shutdown'; restart policy เดิมคือ `no`) แก้แล้ว: `docker-compose.yml` มี `restart: unless-stopped` และใช้ `docker update` กับ container ที่รันอยู่

## 7) ค่าใช้จ่ายและการปิดระบบ

- ทรัพยากรมีค่าใช้จ่ายต่อเนื่อง: ECS Fargate (app 1 task), Express gateway/load balancer, RDS `agrimatch-demo-20261118` (PostgreSQL 16, `db.t4g.micro`, 20 GiB gp3, deletion protection), ECR, CodeBuild, S3 ที่เก็บ source, CloudWatch Logs (7 วัน), Secrets Manager (`runtime`, `demo-accounts`) ตาม `infra/hosting/README.md` (ยังไม่ได้ตรวจใบแจ้งหนี้จริง)
- ไม่มีการลบอัตโนมัติ และ helper ไม่มีคำสั่งลบ/รีเซ็ต
- ก่อนหยุดหรือลบ: ขอคำสั่งจากเจ้าของ, ตรวจสถานะ service/DB ปัจจุบัน, **ทำ snapshot ฐานข้อมูลก่อน**, แล้วจึงลดหรือลบทีละส่วน (deletion protection ของ RDS ต้องปิดอย่างรู้ตัว)
- ห้ามคัดลอก `infra/hosting/private/` และ `infra/hosting/state/` ไปกับ deliverable หรือ commit

## 8) ผลทดสอบ

ผลจากการรันเมื่อ 20 พ.ย. 2026 (ยังไม่ได้รันซ้ำตอนเขียนเอกสารนี้ ยกเว้น acceptance report):

| ชุดทดสอบ | ผล |
| --- | --- |
| lint, typecheck | ผ่าน ไม่มีข้อผิดพลาด |
| api unit | 437 ผ่าน |
| web | 79 ผ่าน |
| DB suite (`npm run test:db`, Postgres ในเครื่อง) | 41 ไฟล์ / 439 test ผ่าน |
| hosted `check-http.py` | ผ่าน |
| hosted login smoke test | ผ่าน (หัวข้อ 1) |

### Acceptance report (รันตอนเขียนเอกสาร)

คำสั่ง: `npm run acceptance:report --workspace apps/api -- https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws` รันสำเร็จ (exit 0) เอาต์พุตไม่แสดงผลตรวจ HTTP ของ URL ที่ส่งเข้าไป (ไม่ได้ตรวจว่าสคริปต์ใช้ argument นี้อย่างไร)

```
Totals: PASS (real)=0 PASS (mock)=12 NOT DONE=5
```

รายการ NOT DONE: ข้อ 1 (งาน 9.10), 3 (18.1), 6 (20.2), 12 (16.2), 14 (13.3)

งานที่ตัดหรือยังไม่เสร็จใน 16–20 (11 งาน): 16.2, 16.4, 17.1, 18.1, 19.1, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6

ส่วนที่ไม่ได้ตรวจกับของจริง (ตามรายงาน): LINE end to end, signature กับทราฟฟิกจาก LINE จริง, Bedrock chat และการประเมินภาพจริง, การส่งแจ้งเตือนจริงที่ล้มเหลวและ retry (PASS (mock) = fake + Postgres ในเครื่องเท่านั้น)
