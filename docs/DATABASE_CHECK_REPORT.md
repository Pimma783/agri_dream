# ผลตรวจฐานข้อมูลสำหรับ Kiro

ตรวจเมื่อ 2026-11-18 19:09 +07

## การเชื่อมต่อ

ตรวจ `.env` ปัจจุบันแล้วพบว่าตั้งค่าถูกต้องอยู่แล้ว จึงไม่ได้แก้หรือเปลี่ยนรหัสผ่าน:

- `DATABASE_URL` เชื่อมต่อจริงสำเร็จที่ `127.0.0.1:5433` ฐาน `agrimatch`
- `TEST_DATABASE_URL` เชื่อมต่อจริงสำเร็จที่ `127.0.0.1:5433` ฐาน `agrimatch_test`
- รหัสใน URL ทั้งคู่ตรงกับ `POSTGRES_PASSWORD`
- ตรวจ `SELECT current_database(), current_user` ผ่านทั้งสอง URL
- ไม่พบตัวแปร DATABASE_URL / TEST_DATABASE_URL / POSTGRES_PASSWORD ที่สืบทอดมาใน process ที่ใช้ตรวจครั้งนี้
- `.env` มีสิทธิ์ไฟล์ `0600` และไม่เปิดเผยค่าลับในรายงาน
- Container `agrimatch-postgres` ทำงานและใช้ volume `agrimatch-mvp_ops-pgdata`

ไม่พบ error `28P01` ในการตรวจหรือชุดทดสอบรอบนี้ สาเหตุของ error ใน environment เดิมของ Kiro ยังยืนยันไม่ได้จาก process นี้ ถ้ายังเกิดเฉพาะ terminal เดิม ให้ตรวจค่าที่สืบทอดใน terminal นั้น เพราะ `process.loadEnvFile()` ไม่เขียนทับ environment ที่มีอยู่แล้ว ห้ามพิมพ์ค่าลับเพื่อเปรียบเทียบ

ไม่ลบข้อมูล ไม่ reset ฐาน ไม่เปลี่ยนรหัส PostgreSQL และไม่แก้ไฟล์ business source หรือ tests ของ Kiro

## ผลคำสั่งที่ร้องขอ

```sh
node scripts/ops-runtime.mjs test-db
```

- Exit code: 1
- Test files: 10 ผ่าน / 3 ไม่ผ่าน รวม 13
- Tests: 133 ผ่าน / 3 ไม่ผ่าน รวม 136
- Duration: 22.36 วินาที
- การเชื่อมต่อฐานข้อมูลผ่านแล้ว แต่ชุดทดสอบยังไม่ผ่านทั้งหมด

## จุดที่ต้องแก้ต่อในโค้ด/ชุดทดสอบ

### 1. harness.db.test.ts — resetData

`resetData empties business tables but keeps the schema usable`

Error: `quantity_ledger is append-only`

Stack: `apps/api/test/db-helper.ts:145` เรียก `TRUNCATE ... RESTART IDENTITY CASCADE` และถูกกลไกป้องกัน ledger หยุดไว้

ข้อสังเกต: เป็นปัญหาความสอดคล้องของ test reset กับกติกา append-only ไม่ใช่การเชื่อมต่อฐานข้อมูล ห้ามปิด trigger หรือผ่อนกติกา production เพียงเพื่อทำให้เทสต์ผ่าน ให้ Kiro ออกแบบการแยกข้อมูล/วงจรชีวิต schema ใน harness ให้สอดคล้องกับกติกา

### 2. line-identity.db.test.ts — farmer follow

`farmer follow creates one personal FARMER organization; double follow does not duplicate it`

Error: `line identity not found after ensure`

Stack: `apps/api/src/repos/identity.ts:124` ผ่าน `apps/api/src/services/identity/service.ts:141` และ `apps/api/test/line-identity.db.test.ts:119`

ต้องตรวจ ensure/transaction และกรณี follow ซ้ำต่อ ยังไม่ได้สรุปสาเหตุเชิงโค้ดและไม่ได้แก้กติกาย้ายบัญชี LINE

### 3. jobs.db.test.ts — outbox DEAD

`goes DEAD on permanent errors and when attempts run out, without touching offers or agreements`

ที่ `apps/api/test/jobs.db.test.ts:142`: คาด `r.dead` เท่ากับ 2 แต่ได้ 1

ให้ตรวจการเลือกงาน ลำดับและการใช้ fake failures รวมถึงการนับ attempts; รายงานนี้ยังไม่ยืนยันสาเหตุที่แท้จริง

## ขั้นต่อไป

Kiro สามารถใช้ฐานข้อมูลเดิมทำงานต่อได้ และควรแก้ 3 กรณีข้างต้นก่อนรันคำสั่งเดิมซ้ำ ไม่ต้องให้ผู้ใช้สมัคร Supabase หรือเปลี่ยนรหัสผ่านเพื่อแก้ 3 failure นี้
