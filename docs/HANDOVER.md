# AGRIMATCH MVP: เอกสารส่งมอบ (HANDOVER)

ข้อมูลในเอกสารนี้มาจากการรันจริงเมื่อ 21 พ.ย. 2026 (Asia/Bangkok) และจากการอ่านไฟล์ใน repo (อ้าง path กำกับ) รายการใดที่ไม่ได้ตรวจ ระบุว่า **ยังไม่ได้ตรวจ** ไม่มีค่าลับในเอกสารนี้ มีเพียงที่เก็บของค่าลับ

## 1) สถานะสรุป

| ส่วน | สถานะ | ตรวจอย่างไร |
| --- | --- | --- |
| Web + API บน AWS (HTTPS) | ใช้งานได้ | `check-http.py` ผ่าน: TLS, health, หน้า login, `/api/me` ตอบ 401 เมื่อไม่ล็อกอิน |
| Webhook 3 บทบาท (`/webhooks/line/farmer\|baler\|factory`) | เปิดแล้ว (Use webhook ON ทั้ง 3 OA) | webhook test ใน LINE Developers Console ได้ 200 ทั้ง 3 OA; `check-http.py`: events ว่างที่เซ็นถูก = 200, ไม่เซ็น = 401 |
| Deploy | สำเร็จ | image `936270099588.dkr.ecr.ap-southeast-1.amazonaws.com/agrimatch-demo-20261118:cloud-4-851ef63eea`; app task definition `agrimatch-demo-20261118-app:6` (รัน 1 task, deployment ล่าสุด SUCCESSFUL); worker `agrimatch-demo-20261118-worker:6` (desired 1, running 1); migration ถึง `1731888400000_canonical-thai-provinces` ถูก apply แล้ว (migrate task exit 0); `check-http.py` ผ่าน |
| ข้อมูลเดโม (seed) | มีแล้ว ทำซ้ำได้ | รันครั้งที่ 1: organizations=6 accounts_created=6 published=10 already_present=0 recomputed=10 match_rows=5; รันซ้ำครั้งล่าสุด: already_present=10 ไม่มีการเปลี่ยนแปลง (entity ID เดิม ไม่แก้ข้อมูลเดิม) |
| ล็อกอินบน hosted | ผ่าน | `demo-factory-a`, `demo-factory-b` (BUYER_FACTORY) และ `demo-baler` (BALER) ล็อกอินได้ (204), `/api/me` 200 พร้อม role ถูก, `/api/matches` 200: โรงงาน A 2 รายการ (route 1), โรงงาน B 2 รายการ (route 1), baler 1 รายการ (route 3); response ไม่มี key `phone`/`email`/`line_user_id`/`owner_user_id` |
| LINE ฝั่งเกษตรกรผ่านแอป LINE จริง | ทดสอบแล้ว (บางส่วน) | follow แล้วลงขายแบบ step-form: ฟางข้าว 5,000 กก. นครสวรรค์ ต่อรองได้ เผยแพร่สำเร็จ และปรากฏในผลจับคู่ของโรงงานเดโมทั้ง 2 แห่ง บั๊กที่พบในการทดสอบนี้แก้และ deploy แล้ว (ดูหัวข้อ 5) |
| LINE: โรงงานเสนอ → เกษตรกรตอบรับ → ข้อตกลง | **ยังไม่ได้ตรวจบน hosted** | hosted offers 0, agreements 0 ณ การตรวจล่าสุด |
| LINE ของ baler/factory (ลิงก์ด้วย link code) | **ยังไม่ได้ตรวจบน hosted** | |
| Bedrock chat / วิเคราะห์ภาพ | เปิดแล้ว รอผลทดสอบผ่าน LINE จริง | `AI_MODE=enabled`, `VISION_ENABLED=true` เปิดเมื่อ 21 พ.ย. เจ้าของกำลังทดสอบ ยังไม่ยืนยัน; ถ้า Bedrock ล้มเหลว เกษตรกรจะถูกส่งไปแบบฟอร์มทีละขั้นอัตโนมัติ |

หมายเหตุขอบเขตการยืนยัน: ผลทดสอบอัตโนมัติ (หัวข้อ 8) ใช้ fake/mock และ Postgres ในเครื่อง ไม่ใช่การยืนยันกับ LINE หรือ Bedrock จริง ตามกฎใน `.kiro/specs/agrimatch-mvp/tasks.md`

## 2) URL และบัญชีเดโม

- URL: https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws (หน้าเข้าสู่ระบบ `/login`)
- AWS บัญชี `936270099588`, region `ap-southeast-1`, ECS cluster/service `agrimatch-demo-20261118`
- ล็อกอิน CLI: `aws sso login --profile ai-hackathon-936270099588` (โปรไฟล์ `default` ชี้ไปบัญชีเก่าและใช้ไม่ได้ ต้องใส่ `--profile` หรือ export `AWS_PROFILE` เสมอ)
- GitHub: repo private https://github.com/Pimma783/agri_plane (branch `main`) ไฟล์ลับ/state ถูก git-ignore: `.env`, `.env.runtime.compose.yml`, `infra/hosting/private/`, `infra/hosting/state/`
- Webhook URL (ตั้งแล้ว, Use webhook ON ทั้ง 3 OA; เจ้าของปิด Greeting และ Auto-reply ของ LINE แล้ว):
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

ข้อสำคัญ: LINE เปิดแล้ว และลงขายฝั่งเกษตรกรทดสอบจริงแล้ว แต่ขั้นที่เหลือบน hosted (โรงงานเสนอ → เกษตรกรตอบรับ → ข้อตกลง, เรื่องอัดฟาง, เรื่องขายต่อ, ลิงก์ LINE ของ baler/factory ด้วย link code, ผล AI chat และภาพ) **ยังไม่ได้ตรวจ** ข้อมูลที่ seed แล้วและประกาศจริงจากการทดสอบทำให้เห็นผลจับคู่จาก Dashboard ได้ทันที

### เรื่องที่ 1: ขายตรง (route 1: เกษตรกร → โรงงานรับซื้อ)
1. ล็อกอิน `demo-factory-a@example.invalid` ที่ `/login`
2. เมนู «ผลจับคู่» (`/matches`) เห็น 2 รายการ route 1 เปิด `/matches/[id]` ดูเหตุผล คะแนน ข้อมูลที่ขาด และ "ระยะเส้นตรง" (verified บน hosted: `/api/matches` 200)
3. สร้างข้อเสนอ (`/offers/new`) แล้วดู `/offers/[id]`
4. ผู้รับข้อเสนอรับ/ปฏิเสธที่ `/offers/[id]` เมื่อรับแล้วมีข้อตกลงที่ `/agreements/[id]` พร้อมข้อความ "ไม่ใช่การชำระเงิน การส่งมอบ หรือคุณภาพ" และปริมาณคงเหลือ
5. ผลที่คาดหวัง: ข้อตกลง 1 รายการ ปริมาณคงเหลือลดตามที่ตกลง
- สถานะการยืนยัน: ส่วนประกาศ/จับคู่ของเรื่องนี้ยืนยันบน hosted แล้วถึง `/api/matches` เท่านั้น ขั้นสร้าง/รับข้อเสนอผ่านการทดสอบอัตโนมัติ (`e2e-story1.db.test.ts`, mock + Postgres ในเครื่อง) **ยังไม่ได้กดผ่านหน้าเว็บบน hosted**
- ส่วน LINE ของเกษตรกร: รหัสอยู่ใน `apps/api/src/channels/line/handlers/farmer.ts` การลงประกาศผ่านแอป LINE จริงทดสอบแล้ว (หัวข้อ 1) ส่วนการรับข้อเสนอ **ยังไม่ได้ทดสอบในแอป LINE จริง**
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
2. ต้องมีประกาศเกษตรกรที่จับคู่ได้ (route 2) แล้วส่ง/รับข้อเสนอจนได้ข้อตกลงแบบ `PURCHASE` ที่ baler เป็นผู้ซื้อ (บน hosted ขั้นนี้ **ยังไม่ได้ตรวจ**: agreements = 0)
3. หน้า `/agreements/[id]` ของ baler มีปุ่ม «สร้างประกาศขายต่อ» (`apps/web/src/components/resale-draft-button.tsx`) เรียก `POST /agreements/:id/resale-draft` (`apps/api/src/http/resale-routes.ts`)
4. **หน้าเว็บขายต่อ:** มีหน้า `/resale` (รายการร่างและประกาศขายต่อของโรงงานอัด) และ `/resale/[draftId]` (แก้ร่าง ดูตัวอย่าง เผยแพร่ด้วย `expectedVersion` และยกเลิกร่างเพื่อคืนปริมาณที่จองไว้) เมนู «ขายต่อ» ตั้ง `ready: true` แล้ว (งาน 16.4) ยังไม่มีปุ่มขายต่อใน LINE ของโรงงานอัด เพราะเดโมให้โรงงานอัดใช้ Dashboard เป็นหลัก และยังไม่ได้ทดสอบเรื่องนี้บน hosted
5. สรุป: **เรื่องที่ 3 ยืนยันระดับ API และการทดสอบอัตโนมัติเท่านั้น** (`resale-draft.db.test.ts`, `resale-publish.db.test.ts`, `e2e-story3.db.test.ts`) บน hosted สาธิตได้สูงสุดถึงการสร้างร่างจากข้อตกลง ไม่ใช่การเผยแพร่ route 4 และการรับของโรงงานปลายทาง
6. เส้นทางที่ไม่ใช้เว็บ: เผยแพร่ผ่าน API ต้องใช้ session + CSRF (`GET /me` ให้ `csrf_secret`) **ยังไม่ได้ตรวจบน hosted**

### สคริปต์สาธิต

1. เกษตรกรใน LINE (`@642ctpqm`): พิมพ์ «ลงขายวัสดุ» แล้วตอบทีละขั้น หรือพิมพ์ข้อความอิสระให้ AI ช่วย (ยังรอผลทดสอบจริง; ถ้า AI ล้มเหลวจะกลับไปแบบฟอร์มทีละขั้น) แล้วส่งรูปเพื่อดูผลประเมินเบื้องต้นพร้อมข้อความปฏิเสธความรับผิด (ยังรอผลทดสอบจริง)
2. โรงงานบน Dashboard: ล็อกอิน `demo-factory-a@example.invalid` → «ผลจับคู่» → เปิดรายการ → «เริ่มเสนอข้อตกลง»
3. เกษตรกรใน LINE: กด «ตอบรับ» → เกิดข้อตกลง (ขั้นนี้ยังไม่ได้ตรวจบน hosted ควรซ้อมก่อนสาธิต)
4. baler บน Dashboard: ล็อกอิน `demo-baler@example.invalid` → บริการรับจ้างอัด (`/services`) และการขายต่อ (ข้อจำกัดของหน้า resale ดูเรื่องที่ 3 และหัวข้อ 6)

### งานค้างที่กระทบการสาธิต
ดูหัวข้อ 6 โดยเฉพาะ 9.10/18.1 (LINE ของ baler/factory), 13.3 (รูปจาก LINE), 16.4 (หน้า resale), 17.1

## 4) วิธี deploy ซ้ำ

ล็อกอินก่อน: `aws sso login --profile ai-hackathon-936270099588` แล้วส่ง `--profile` หรือ export `AWS_PROFILE` ทุกครั้ง

ทำที่ root ของ repo ใช้ `infra/hosting/aws-runtime.py` (คำสั่งที่มีจริง: `bootstrap`, `database`, `register`, `image`, `build`, `build-status`, `migrate`, `verify`, `seed-setup`, `seed`, `seed-status`, `publish`, `status`) **ต้องได้รับอนุญาตจากเจ้าของก่อนรันทุกครั้ง** เพราะเป็นการเปลี่ยนทรัพยากร AWS

```sh
python infra/hosting/aws-runtime.py build
python infra/hosting/aws-runtime.py build-status      # รอ SUCCEEDED; image_uri อยู่ใน infra/hosting/state/aws.json
python infra/hosting/aws-runtime.py register <image-uri>
python infra/hosting/aws-runtime.py migrate
python infra/hosting/aws-runtime.py status            # รอ Migration: STOPPED exit 0 (publish ปฏิเสธถ้า migrate ไม่ exit 0)
python infra/hosting/aws-runtime.py verify            # ตรวจ verify task exit 0
python infra/hosting/aws-runtime.py publish           # worker อยู่ที่ 1 บน revision ใหม่โดยปริยาย
python infra/hosting/aws-runtime.py status
python infra/hosting/aws-runtime.py seed              # ถ้าจำเป็นเท่านั้น (ทำซ้ำได้) ต้องเคย seed-setup แล้ว และ register image ใหม่ก่อน
python infra/hosting/aws-runtime.py seed-status       # ดู exit code และบรรทัดสรุปจำนวน (ไม่พิมพ์ค่าลับ)
python infra/hosting/check-http.py https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws
```

วิธีตรวจหลัง deploy:
- deployment ล่าสุดของ service ต้อง SUCCESSFUL (ไม่ดูแค่ ACTIVE เพราะรุ่นเก่าอาจยังรันหลัง rollback), `app` task revision ใหม่เป็น PRIMARY
- `check-http.py` ผ่านทุกข้อ
- seed: ครั้งแรก `accounts_created=6 published=10`; รันซ้ำต้องได้ `already_present=10 recomputed=0` และ entity ID เดิม
- `publish` คง worker ไว้ที่ 1 บน revision ใหม่โดยปริยาย (เดิมจอดที่ 0) ตั้ง `AGRIMATCH_WORKER_COUNT=0` เพื่อจอด worker (ฟังก์ชัน `publish` ใน `infra/hosting/aws-runtime.py`)
- สวิตช์ rollback (ตั้งเป็น env ก่อน `register`): `AGRIMATCH_AI_MODE=disabled`, `AGRIMATCH_VISION_ENABLED=false` แล้ว register + migrate + publish (ค่าปริยายของสองตัวนี้คือ enabled/true)
- ลำดับ deploy: build → build-status → register <image_uri> → migrate (รอ exit 0) → verify → publish → status → `check-http.py`
- seed รันซ้ำได้ ครั้งล่าสุด: already_present=10 ไม่มีการเปลี่ยนแปลง
- ไม่มีคำสั่งลบ/รีเซ็ตใน helper โดยตั้งใจ
- รายละเอียดเพิ่มเติม: `infra/hosting/README.md`, `docs/AWS_HOSTING_HANDOFF.md` (เอกสารนี้ลงวันที่ 19 พ.ย. และบางส่วนล้าสมัย เช่น image รุ่นเก่า)

## 5) สถานะ LINE และ AI บน hosted

ค่าที่ตั้งบน cloud ตอนนี้ (เปิดแล้วโดยเจ้าของ): `ENABLE_REAL_LINE=true`, `ENABLE_REAL_BEDROCK=true`, `AI_MODE=enabled`, `VISION_ENABLED=true`, `BEDROCK_MODEL_ID` และ `BEDROCK_VISION_MODEL_ID` = `anthropic.claude-sonnet-5`

1. Worker `agrimatch-demo-20261118-worker`: desired 1, running 1 บน revision `:6` (`apps/api/src/worker.ts` ลงทะเบียน `line_event`)
2. LINE: Use webhook ON ทั้ง 3 OA (`@642ctpqm` เกษตรกร, `@237ozbsh` baler, `@241sxehz` โรงงาน) webhook test ได้ 200 ทั้งหมด; เจ้าของปิด Greeting และ Auto-reply แล้ว
3. ทดสอบ LINE เกษตรกรจริงแล้ว (ดูหัวข้อ 1) บั๊กที่พบแก้และ deploy แล้ว: ปุ่ม greeting, คีย์เวิร์ดเมนูภาษาไทย (รวม «อยากขายฟาง», «ลงขายวัสดุ», «รายการของฉัน», «ข้อเสนอ»), ยกเลิก/เมนู กลางแบบฟอร์ม, แจ้งโหมดครั้งเดียว, ชื่อจังหวัดภาษาไทยแบบ canonical พร้อม data-fix migration, คำถามตำแหน่งที่มีปุ่ม «ข้าม», หน้า login ไม่แสดง "session expired" ตอนเข้าครั้งแรก
4. AI chat และวิเคราะห์ภาพผ่านแอป: **เปิดแล้ว รอผลทดสอบผ่าน LINE จริง** เจ้าของกำลังทดสอบ ยังไม่ได้ยืนยัน ถ้า Bedrock ล้มเหลว เกษตรกรจะถูกส่งไปแบบฟอร์มทีละขั้นอัตโนมัติ
5. **ยังไม่ได้ตรวจบน hosted:** โรงงานเสนอ → เกษตรกรตอบรับใน LINE → ข้อตกลง (hosted offers 0, agreements 0 ณ การตรวจล่าสุด), เรื่องอัดฟาง, เรื่องขายต่อ, การลิงก์ LINE ของ baler/factory ด้วย link code, ผล AI chat และ vision
6. การแก้ env/secret บน AWS ต้อง register/publish ใหม่ให้ task โหลดค่าใหม่ การเปลี่ยนแปลงทรัพยากร AWS ต้องได้รับอนุญาตจากเจ้าของก่อน

ชื่อค่าตั้งค่า (ทั้งหมดอยู่ใน `.env.example`; ห้ามใส่ค่าจริงในเอกสาร): `NODE_ENV`, `PORT`, `DATABASE_URL`, `TEST_DATABASE_URL`, `WEB_ORIGIN`, `API_INTERNAL_URL`, `ENABLE_REAL_LINE`, `ENABLE_REAL_BEDROCK`, `AI_MODE`, `ENABLE_REAL_S3` (ไม่ใช้แล้ว: รูปเก็บใน PostgreSQL), `VISION_ENABLED`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_VISION_MODEL_ID`, `LOCAL_MEDIA_DIR` (ไม่ใช้แล้ว), `SESSION_SECRET`, `LINE_{FARMER,BALER,FACTORY}_CHANNEL_SECRET`, `LINE_{FARMER,BALER,FACTORY}_ACCESS_TOKEN`, `MEDIA_URL_TTL_SECONDS`
- ค่าบน hosted เก็บใน Secrets Manager `agrimatch-demo-20261118/runtime` (ไม่ใช่ `.env` ในเครื่อง)
- Bedrock: ใช้ `anthropic.claude-sonnet-5` ใน `ap-southeast-1` เท่านั้น ห้ามรหัสโมเดลที่ขึ้นต้น `global.` หรือ `apac.` (`apps/api/src/config/guards.ts` ปฏิเสธ)
- URL เว็บและ API เป็น origin เดียว: `/api/*` ถูก rewrite โดย Next.js และ nginx ใน container เดียว; `WEB_ORIGIN` ต้องตรง URL จริง
- Smoke test: `python infra/hosting/check-http.py <URL>` (health, signature 200/401); `python infra/hosting/aws-runtime.py verify` (Bedrock 1 ครั้งและ LINE bot info); ในเครื่อง `ENABLE_REAL_BEDROCK=true npx tsx apps/api/scripts/bedrock-smoke.ts --yes` (เรียก Converse 1 ครั้ง, ยังไม่ได้รันในรอบนี้)
- **S3:** งาน 21.2 (ไฟล์ IaC สำหรับ S3/IAM) ยังไม่เสร็จ ไม่มีไฟล์ใน `infra/` (มีแค่ `hosting` และ `postgres`) และรูปเก็บใน PostgreSQL จึงไม่มี S3 put/presign ให้ทดสอบ ผู้ตรวจสอบและผู้อนุมัติ IaC เป็นประเด็นเปิด

## 6) ข้อจำกัดและงานค้าง

งานที่ยังไม่เสร็จ (อ้าง `.kiro/specs/agrimatch-mvp/tasks.md` และ `npm run acceptance:report`):
- 9.10 / 18.1: handler LINE ของ baler/factory ตอบเพียง placeholder
- 13.3: ภาพจาก LINE ของเกษตรกร (ภาพแนบกับร่างเท่านั้น และไม่มีการ push สรุปผลประเมิน)
- 16.2: property test ของ resale allocation (Property 13)
- 16.4: หน้า Dashboard `/resale`, `/resale/[draftId]` และปุ่ม LINE ขายต่อ
- 17.1: baling_request ผ่านแชท (ยังไม่เสร็จ/ปรับปรุง)
- 19.x, 20.x (P1/P2) ยังไม่ทำ: rich menu, หน้า assistant บน Dashboard, สรุปบทสนทนา, จัดการยกเลิกข้อตกลงต้นทาง, แผนที่/ตัวกรอง (รวมภาพสำหรับ role อื่น, หน้าภาพรวมและตั้งค่าองค์กร)
- 21.2: ไฟล์ IaC S3/IAM ยังไม่เสร็จ
- 22 (checkpoint สุดท้าย) ยังไม่ปิด

ข้อจำกัดอื่น:
- LINE ในแอปจริงทดสอบเฉพาะฝั่งเกษตรกร (ลงขาย) ส่วนที่เหลือดูหัวข้อ 5
- Bedrock chat/ภาพ: เปิดแล้ว รอผลทดสอบผ่าน LINE จริง; `verify` ตรวจ Converse โดยตรงเท่านั้น
- ประกาศขายต่อบนเว็บไม่มีพิกัด (resale web listing has no coordinates)
- ฟิลด์หลังอัดฟางรองรับเฉพาะ BALED/LOOSE
- โรงงานเห็นข้อความ pending-material ack เฉพาะหลังตอบรับล้มเหลวเท่านั้น
- รูปแนบกับร่าง (draft) เท่านั้น; ไม่มีการ push สรุปผลประเมินภาพ
- ไม่มี payment และไม่มีการซื้อขายคาร์บอนใน MVP; ราคาและผลตอบแทนเป็นค่าประมาณ น้ำหนักจับคู่เป็นค่าเดโม
- ประเด็นเปิด: นโยบายความเป็นส่วนตัว, LIFF ไม่ได้ใช้, ค่าเริ่มต้นของ `packages/contracts`, ผู้ตรวจ/ผู้อนุมัติ IaC
- Postgres ในเครื่องเคยหยุด 2 ครั้งเพราะเครื่องโฮสต์ปิด (graceful 'fast shutdown'; restart policy เดิมคือ `no`) แก้แล้ว: `docker-compose.yml` มี `restart: unless-stopped` และใช้ `docker update` กับ container ที่รันอยู่

## 7) ค่าใช้จ่ายและการปิดระบบ

- ทรัพยากรมีค่าใช้จ่ายต่อเนื่อง: ECS Fargate (app 1 task + worker 1 task), Express gateway/load balancer, RDS `agrimatch-demo-20261118` (PostgreSQL 16, `db.t4g.micro`, 20 GiB gp3, deletion protection), ECR, CodeBuild, S3 ที่เก็บ source, CloudWatch Logs (7 วัน), Secrets Manager (`runtime`, `demo-accounts`) ตาม `infra/hosting/README.md` (ยังไม่ได้ตรวจใบแจ้งหนี้จริง)
- ไม่มีการลบอัตโนมัติ และ helper ไม่มีคำสั่งลบ/รีเซ็ต
- ก่อนหยุดหรือลบ: ขอคำสั่งจากเจ้าของ, ตรวจสถานะ service/DB ปัจจุบัน, **ทำ snapshot ฐานข้อมูลก่อน**, แล้วจึงลดหรือลบทีละส่วน (deletion protection ของ RDS ต้องปิดอย่างรู้ตัว)
- ห้ามคัดลอก `infra/hosting/private/` และ `infra/hosting/state/` ไปกับ deliverable หรือ commit

## 8) ผลทดสอบ

ผลการรันล่าสุด (ณ 21 พ.ย. 2026; acceptance report ด้านล่างเป็นผลของรอบ 20 พ.ย.):

| ชุดทดสอบ | ผล |
| --- | --- |
| lint, typecheck | ผ่าน ไม่มีข้อผิดพลาด |
| api unit | 466 ผ่าน |
| web | 101 ผ่าน |
| DB suite (`npm run test:db`, Postgres ในเครื่อง; container ตั้ง `restart: unless-stopped`) | 45 ไฟล์ / 478 test ผ่าน |
| hosted `check-http.py` | ผ่าน |
| hosted login smoke test | ผ่าน (หัวข้อ 1) |

### Acceptance report (รอบ 20 พ.ย. ยังไม่ได้รันซ้ำ)

คำสั่ง: `npm run acceptance:report --workspace apps/api -- https://ag-2d2154d60d0b447db3c6a74fb3b6224f.ecs.ap-southeast-1.on.aws` รันสำเร็จ (exit 0) เอาต์พุตไม่แสดงผลตรวจ HTTP ของ URL ที่ส่งเข้าไป (ไม่ได้ตรวจว่าสคริปต์ใช้ argument นี้อย่างไร)

```
Totals: PASS (real)=0 PASS (mock)=12 NOT DONE=5
```

รายการ NOT DONE: ข้อ 1 (งาน 9.10), 3 (18.1), 6 (20.2), 12 (16.2), 14 (13.3)

งานที่ตัดหรือยังไม่เสร็จใน 16–20 (11 งาน): 16.2, 16.4, 17.1, 18.1, 19.1, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6

ส่วนที่ไม่ได้ตรวจกับของจริง (ตามรายงาน): LINE end to end, signature กับทราฟฟิกจาก LINE จริง, Bedrock chat และการประเมินภาพจริง, การส่งแจ้งเตือนจริงที่ล้มเหลวและ retry (PASS (mock) = fake + Postgres ในเครื่องเท่านั้น)
