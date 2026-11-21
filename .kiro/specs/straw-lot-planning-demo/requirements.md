# Requirements Document

## Introduction

เดโมเว็บภาษาไทยแบบ mobile-first ที่ใช้เป็นหน้าเดียวกันทั้งบนเบราว์เซอร์ทั่วไปและใน LINE LIFF ครอบคลุมสองส่วน

1. **ค้นหาโรงงาน (F3):** เกษตรกรเลือกวัสดุ ปริมาณเป็นตัน และจังหวัดจุดรับ แล้วเห็นโรงงานที่รับวัสดุนั้นภายใน 80 กม. เรียงตามราคาจำลองจากมากไปน้อย ระยะทางจากน้อยไปมาก และรหัสโรงงาน ส่วนนี้ใช้กติกา Python เดิมใน `matching.py` (`find_biomass_buyers`) และ endpoint `POST /api/matches` โดยไม่เปลี่ยนพฤติกรรม ข้อกำหนดของส่วนนี้สอดคล้องกับ spec แยก `f3-smart-matching` ซึ่งไม่ถูกแก้ไข
2. **วางแผนล็อตฟางข้าว:** ผู้ประสานงานบันทึกออเดอร์จากโรงงาน ระบบเสนอชุดแปลงด้วยกติกาฝั่งเซิร์ฟเวอร์ที่อธิบายเหตุผลได้ ผู้ประสานงานปรับชุดแปลงได้ จากนั้นบันทึกการยืนยันจากโรงงาน เกษตรกรเจ้าของแปลง และผู้รับจ้างอัดฟ่อน/ขนส่ง บันทึกน้ำหนักชั่งจริงและปิดล็อต

เดโมใช้ข้อมูลจำลองและกติกาที่ตรวจสอบย้อนได้ ไม่ต้องใช้ AWS credentials ผู้ประสานงานบันทึกการยืนยันด้วยมือ ระบบไม่ส่งข้อความจริงไปยังบุคคลใด

**ขอบเขตที่อยู่นอกเดโมนี้:** การส่งข้อความ LINE จริง การจ่ายเงิน การซื้อขายหรืออ้างสิทธิ์คาร์บอนเครดิต การยืนยันตัวตนผู้ใช้จริง การรวมกลุ่มเกษตรกรแบบ F5 (3–5 ราย ภายใน 10 กม.) การคำนวณรายได้สุทธิหรือกำไรของเกษตรกร และการแก้ `agent.py`

**ที่มา:** `docs/submission.md` (Decision Log: เพดานขนส่ง 80 กม. ไม่รวมการจ่ายเงินและคาร์บอนเครดิตใน MVP), `.kiro/steering/product.md`, `tech.md`, `structure.md`, `aws.md`, `matching.py`, `webapp.py`, `web/app.js`, `README.md` และ spec `f3-smart-matching`

**หมายเหตุขอบเขต:** การวางแผนล็อตข้อ 2 ใกล้เคียงงานรวมปริมาณและโลจิสติกส์ (F5/F6) ที่ `product.md` จัดเป็นงานเพิ่มประสิทธิภาพภายหลัง เดโมนี้ทำเฉพาะ flow ที่ผู้ใช้ระบุ โดยไม่ใช้กติการวมกลุ่ม 10 กม. และไม่ถือเป็นการยืนยันสมมติฐานการประหยัดต้นทุน

## Assumptions

ค่าต่อไปนี้เป็นสมมติฐานของเดโม ไม่ใช่ข้อเท็จจริงจากโรงงานหรือผู้รับจ้างจริง และระบบต้องแสดงว่าเป็น «ประมาณการ» หรือ «ข้อมูลจำลอง» เมื่อนำไปแสดงผล

- **A1 อัตราต้นทุนจำลอง:** ราคาฟางที่จ่ายเกษตรกร 300 บาท/ตัน ค่าอัดฟ่อน 250 บาท/ตัน ค่าขนส่ง 5 บาท/ตัน/กม. คูณระยะทางจากแปลงถึงโรงงาน ค่าเหล่านี้เป็นค่าคงที่ในโค้ดเดียวที่ทดสอบได้
- **A2 คิวจำลอง:** คิวรถอัดฟ่อนและคิวรถขนเป็นช่องวันที่ระดับล็อต ความจุช่องละ 15 ตัน/วัน ช่องวันที่อ้างอิงจากวันที่สร้าง session
- **A3 วันที่ในข้อมูลจำลอง:** วันพร้อมเก็บเกี่ยวและวันที่ต้องเคลียร์แปลงเป็นจำนวนวันนับจากวันที่สร้าง session เพื่อให้เดโมใช้ซ้ำได้ทุกวัน
- **A4 ระยะทางจากแปลงถึงโรงงาน:** เป็นค่าจำลองต่อคู่แปลง–โรงงานใน fixture ไม่คำนวณจากพิกัดจริง ระยะ 80 กม. ใช้ตัวเลขนี้ ไม่ใช่ระยะทางเส้นตรง
- **A5 ความชื้นสูงสุดตั้งต้น:** 20% ผู้ประสานงานแก้ได้ต่อออเดอร์
- **A6 ส่วนเผื่อ:** ชุดแปลงที่เสนอมีปริมาณประมาณการไม่น้อยกว่า 120% ของเป้าหมาย (เป้าหมาย 10 ตัน เสนอประมาณ 12 ตัน) เพื่อรองรับน้ำหนักจริงที่ต่ำกว่าประมาณการ
- **A7 ลำดับเลือกแปลง:** เรียงแปลงที่ผ่านเงื่อนไขตามระยะทางถึงโรงงานจากน้อยไปมาก วันพร้อมเก็บเกี่ยวจากเร็วไปช้า และรหัสแปลง แล้วเลือกจากต้นรายการจนถึงปริมาณตามข้อ A6
- **A8 การระบุ session:** เซิร์ฟเวอร์ออก session token แบบสุ่มเก็บใน cookie และเก็บสถานะในหน่วยความจำของเซิร์ฟเวอร์ พร้อมอายุหมดเวลาเมื่อไม่มีการใช้งาน 24 ชั่วโมง สถานะอยู่ข้ามการรีเฟรชหน้า แต่หายเมื่อรีสตาร์ตเซิร์ฟเวอร์หรือ session หมดอายุ และไม่เชื่อมกับ LINE userId
- **A9 ความชื้นที่ยังไม่ทราบ:** แปลงที่ไม่มีค่าความชื้นแสดง «รอตรวจ» ไม่ถูกตัดออกและไม่ขัดขวางการยืนยัน แต่ต้องแสดงเป็นเงื่อนไขค้างตรวจในหน้าล็อต
- **A10 ชื่อบุคคล:** ชื่อเกษตรกร ผู้รับจ้าง และโรงงานเป็นชื่อสมมติ ไม่มีข้อมูลส่วนบุคคลจริง
- **A11 เพดานน้ำหนักจริง:** น้ำหนักชั่งจริงที่รับได้คือตัวเลขจำกัดค่ามากกว่า 0 และไม่เกิน 100 ตัน
- **A12 ตัวเลือกโรงงานของออเดอร์:** โรงงานในออเดอร์เลือกจากโรงงานจำลองใน `BUYERS` ที่รับฟางข้าวและเปิดรับซื้อ
- **A13 การปัดเศษ:** ต้นทุนส่งถึงโรงงานต่อตันปัดเป็นบาทเต็มแบบปัดครึ่งขึ้น น้ำหนักแสดงทศนิยมได้ไม่เกิน 2 ตำแหน่ง
- **A14 กลุ่มผู้ยืนยัน:** ผู้ยืนยัน = โรงงาน 1 ราย + เกษตรกรเจ้าของแปลงแต่ละรายในชุดที่เลือก (หนึ่งเจ้าของต่อหนึ่งแปลง นับเจ้าของที่ซ้ำเป็นหนึ่งผู้ยืนยัน) + ผู้รับจ้างอัดฟ่อนและขนส่ง 1 ราย

## Glossary

- **Demo_Web**: เว็บแอปเดโมของโปรเจกต์ ประกอบด้วยหน้าเว็บ `web/` และเซิร์ฟเวอร์ WSGI `webapp.py`
- **Search_Service**: ส่วนของเซิร์ฟเวอร์ที่เรียก `find_biomass_buyers` ใน `matching.py` เพื่อค้นหาโรงงาน (F3)
- **Lot_Planner**: ส่วนของเซิร์ฟเวอร์ที่ใช้กติกาเสนอและตรวจชุดแปลง คิว และต้นทุนส่งถึงโรงงาน
- **Lot_Service**: ส่วนของเซิร์ฟเวอร์ที่ตรวจและเปลี่ยนสถานะออเดอร์และล็อต
- **Session_Store**: ที่เก็บสถานะเดโมแยกตาม session
- **Coordinator**: ผู้ประสานงานภาคสนามที่ใช้ Demo_Web บันทึกออเดอร์ ปรับชุดแปลง และบันทึกการยืนยัน
- **Farmer**: เกษตรกรที่ใช้หน้าค้นหาโรงงาน
- **Plant**: โรงงานรับซื้อชีวมวลจำลอง (ผู้ซื้อ)
- **Order**: ออเดอร์ของ Plant ระบุวัสดุ ปริมาณเป้าหมายเป็นตัน ราคาเสนอรับซื้อ ความชื้นสูงสุด และวันส่งมอบ
- **Plot**: แปลงของ Farmer มีเจ้าของ วัสดุ ระยะทางจำลองถึง Plant ปริมาณคาดการณ์เป็นตัน วันพร้อมเก็บเกี่ยว วันที่ต้องเคลียร์แปลง และความชื้น (ถ้าทราบ)
- **Queue_Slot**: ช่องวันที่ในคิวรถอัดฟ่อนหรือรถขนส่งของ Contractor พร้อมความจุเป็นตัน
- **Contractor**: ผู้รับจ้างอัดฟ่อนและขนส่งจำลอง
- **Lot**: ชุดแปลงที่ผูกกับ Order หนึ่งรายการ พร้อมช่องคิวอัดฟ่อน ช่องคิวขน สถานะ และการยืนยัน
- **Lot_Status**: สถานะของ Lot ได้แก่ «ร่าง», «รอยืนยัน», «พร้อมดำเนินงาน» และ «ปิดล็อต»
- **Target_Tons**: ปริมาณเป้าหมายของ Order
- **Estimated_Tons**: ผลรวมปริมาณคาดการณ์ของ Plot ที่เลือก
- **Actual_Tons**: น้ำหนักที่ชั่งได้จริงเมื่อส่งมอบ
- **Plant_Offer_Price**: ราคาที่ Plant เสนอรับซื้อต่อตันใน Order
- **Delivered_Cost**: ต้นทุนส่งถึงโรงงานต่อตัน = (ราคาฟางที่จ่ายเกษตรกร + ค่าอัดฟ่อน + ค่าขนส่ง) ÷ Estimated_Tons
- **Confirmation**: บันทึกว่า Plant, Farmer เจ้าของแปลง หรือ Contractor ยืนยันแล้ว ซึ่ง Coordinator เป็นผู้บันทึกด้วยมือ
- **Session**: ช่วงใช้งานเดโมของผู้ทดลองหนึ่งคน ตามข้อสมมติ A8
- **Revision**: หมายเลขรุ่นของสถานะ Lot ที่เพิ่มขึ้นทุกครั้งที่บันทึกการเปลี่ยนแปลง

## Requirements

### Requirement 1: ค้นหาโรงงานรับซื้อ (F3)

**User Story:** As a Farmer, I want to search for plants that accept my residue within transport range, so that I can compare plants from clear conditions.

#### Acceptance Criteria

1. WHEN a Farmer submits a supported material («ฟางข้าว», «ซังข้าวโพด» or «ใบอ้อย»), a quantity in tons greater than zero, and a pilot province («อุตรดิตถ์», «นครสวรรค์» or «กำแพงเพชร»), THE Search_Service SHALL return only Plants that are open for buying, accept that material, have a minimum quantity not above the submitted quantity, and have a route distance of 80 km or less for that province.
2. WHEN one eligible Plant is at 80.0 km and another is at 80.1 km, THE Search_Service SHALL include the first Plant and exclude the second Plant.
3. WHEN several Plants qualify, THE Search_Service SHALL order them by simulated price per ton descending, then distance ascending, then buyer id ascending.
4. WHEN the Search_Service returns one or more Plants, THE Demo_Web SHALL display, for each matched Plant, the Plant name, the distance in km, and the simulated price in baht per ton labeled «ราคาจำลอง».
5. WHEN the same search input is submitted twice with unchanged fixture data, THE Search_Service SHALL return the same Plants in the same order (idempotence).
6. THE Demo_Web SHALL keep the request and response behavior of `GET /api/config` and `POST /api/matches` backward compatible with the existing F3 web page.

### Requirement 2: ข้อผิดพลาด ผลว่าง และลองใหม่ของการค้นหา

**User Story:** As a Farmer, I want clear messages and a way to retry when a search fails, so that I do not lose what I typed.

#### Acceptance Criteria

1. IF the material is unsupported, the quantity is not a finite number greater than zero, or the province is outside the pilot area, THEN THE Search_Service SHALL return HTTP 422 with one Thai error message per invalid field, identify each invalid field, and SHALL NOT run the search.
2. IF the search request body is missing, larger than 4096 bytes, or not a JSON object, THEN THE Search_Service SHALL return HTTP 400 with one Thai error message and SHALL NOT run the search.
3. WHEN the Search_Service returns field errors, THE Demo_Web SHALL show each message next to its field and SHALL retain every value the Farmer entered.
4. WHEN a valid search finds no Plant that meets the conditions, THE Demo_Web SHALL show «ไม่พบโรงงานที่ตรงเงื่อนไข» on the same screen, SHALL retain the entered values, and SHALL NOT show the load-failure message or the retry control.
5. IF the search request or the option load fails because of a network error, no response within 10 seconds, or an HTTP 5xx response, THEN THE Demo_Web SHALL show «โหลดผลไม่ได้», SHALL retain the entered values, SHALL show a retry control, and SHALL remove any previous result list from the screen.
6. WHEN the Farmer activates the retry control, THE Demo_Web SHALL resend the request with the retained values, and IF the request succeeds, THEN THE Demo_Web SHALL remove the «โหลดผลไม่ได้» message and the retry control and SHALL show the search result or the no-result message from criterion 4.
7. IF a retry request fails, THEN THE Demo_Web SHALL keep «โหลดผลไม่ได้» and the retry control visible, SHALL retain the entered values, and SHALL allow further retries.

### Requirement 3: เปิดออเดอร์จากโรงงาน

**User Story:** As a Coordinator, I want to record that a plant wants a quantity of rice straw, so that the lot has clear conditions to meet.

#### Acceptance Criteria

1. WHEN the Coordinator submits a Plant, the material «ฟางข้าว», a Target_Tons value greater than 0 and at most 100 with up to 2 decimal places, a Plant_Offer_Price greater than 0 and at most 100,000 baht per ton, a maximum moisture percentage from 1 to 100 inclusive, and a delivery date on or after the Session start date, THE Lot_Service SHALL create exactly one Order and exactly one Lot with Lot_Status «ร่าง», and SHALL link the Lot to the Order.
2. WHEN an Order is created, THE Demo_Web SHALL display the conditions the Lot must pass: material, Target_Tons, delivery date, maximum moisture, the 80 km distance limit, and the requirement that the haul date is on or before the delivery date.
3. IF any Order field is missing, is outside the ranges in criterion 1, or is not of the expected type, THEN THE Lot_Service SHALL reject the request with HTTP 422, SHALL identify every invalid field in a single response, SHALL create no Order or Lot, and SHALL leave the Session state unchanged.
4. IF the submitted Plant is not in the fixture, is not open, or does not accept rice straw, THEN THE Lot_Service SHALL reject the request with HTTP 422, SHALL return an error message on the Plant field, SHALL create no Order or Lot, and SHALL leave the Session state unchanged.
5. WHEN the Coordinator opens the order form, THE Demo_Web SHALL offer a preset that fills Target_Tons with 10 and leaves every other field editable.
6. THE Demo_Web SHALL display the Plant_Offer_Price with the label «ราคาที่โรงงานเสนอ» in an element separate from every cost estimate, and SHALL NOT sum or net the Plant_Offer_Price with any cost estimate within that element.

### Requirement 4: คัดแปลงที่เข้าเงื่อนไข

**User Story:** As a Coordinator, I want the system to screen plots by material, distance, harvest window, moisture, and queue, so that only workable plots are proposed.

#### Acceptance Criteria

1. WHEN the Lot_Planner screens a Plot against an Order, THE Lot_Planner SHALL treat the Plot as eligible only when the Plot material equals the Order material, the Plot distance to the Plant is 80 km or less (80.0 km is eligible, 80.1 km is not), and the Plot moisture is unknown or is less than or equal to the Order maximum moisture.
2. IF the Plot moisture is not known, THEN THE Lot_Planner SHALL treat the Plot as eligible on moisture and THE Demo_Web SHALL display «รอตรวจ» for that Plot.
3. IF a Plot moisture is above the Order maximum moisture, THEN THE Lot_Planner SHALL exclude the Plot and THE Demo_Web SHALL display the exclusion reason containing the measured moisture percentage and the allowed maximum percentage.
4. IF a Plot distance to the Plant is above 80 km, THEN THE Lot_Planner SHALL exclude the Plot and THE Demo_Web SHALL display the exclusion reason containing the Plot distance in km and the 80 km limit.
5. IF the material of a Plot differs from the Order material, THEN THE Lot_Planner SHALL exclude the Plot and THE Demo_Web SHALL display the exclusion reason naming both the Plot material and the Order material.
6. WHEN the Lot_Planner evaluates a baling date for a Plot, THE Lot_Planner SHALL treat the date as feasible only when it is on or after the Plot ready date and on or before the Plot last clearing date, inclusive of both boundary dates.
7. WHEN the Lot_Planner evaluates a haul date, THE Lot_Planner SHALL treat the date as feasible only when it is on or after the baling date and on or before the Order delivery date, inclusive of both boundary dates.
8. IF no feasible baling date or no feasible haul date exists for a Plot, THEN THE Lot_Planner SHALL exclude the Plot and THE Demo_Web SHALL display the exclusion reason stating whether the baling window or the haul window has no feasible date.
9. WHEN the Coordinator views the plot list of a Lot, THE Demo_Web SHALL list excluded Plots, each with its exclusion reason, in a section separate from the selected Plots.
10. WHEN a Coordinator records a moisture reading from 0 to 100 percent for a Plot with unknown moisture, THE Lot_Planner SHALL re-evaluate the Plot using the eligibility rules of this requirement with the new value and THE Demo_Web SHALL update the eligibility status and reason of the Plot.
11. IF a Coordinator records a moisture reading below 0, above 100, or non-numeric, THEN THE Lot_Service SHALL reject the reading with HTTP 422 and a message stating the allowed range of 0 to 100, and SHALL keep the previous Plot moisture value unchanged.

### Requirement 5: เสนอชุดแปลงและคิว

**User Story:** As a Coordinator, I want a proposed set of plots and queue slots with reasons, so that I can see how the order can be filled.

#### Acceptance Criteria

1. WHEN the Coordinator requests a proposal for a Lot in Lot_Status «ร่าง», THE Lot_Planner SHALL select eligible Plots one at a time in the order of assumption A7 and SHALL stop selecting when Estimated_Tons reaches at least 120% of Target_Tons or no eligible Plot remains.
2. WHEN the Coordinator requests a proposal for the preset Order of 10 tons of rice straw with the standard mock data, THE Lot_Planner SHALL select exactly three Plots with expected tons 4, 3, and 5 and SHALL report Estimated_Tons of 12.
3. WHEN the Lot_Planner has selected Plots, THE Lot_Planner SHALL select one baling Queue_Slot and one haul Queue_Slot such that every selected Plot has a feasible baling date, the haul date is feasible, and the remaining capacity of each Queue_Slot, in tons, is not below Estimated_Tons.
4. WHEN the Lot_Planner returns a proposal, THE Demo_Web SHALL display for each selected Plot the owner, expected tons, distance in km, ready date, last clearing date, moisture or «รอตรวจ» if no moisture value exists, and a Thai reason naming the rule that selected the Plot.
5. WHEN the Lot_Planner returns a proposal with an assigned queue, THE Demo_Web SHALL display Estimated_Tons, the selected baling date, the selected haul date, and the Delivered_Cost labeled «ประมาณการ».
6. IF the eligible Plots together have less than Target_Tons, THEN THE Lot_Planner SHALL return all eligible Plots found, SHALL report the shortfall as Target_Tons minus Estimated_Tons in tons, and THE Demo_Web SHALL display the shortfall next to Estimated_Tons.
7. IF no pair of baling and haul Queue_Slots satisfies requirement 5.3 for the selected Plots, THEN THE Lot_Planner SHALL report each failing condition (ready date, last clearing date, delivery date, or queue capacity), SHALL NOT assign a queue, SHALL keep the selected Plots in the result, and THE Demo_Web SHALL display the failing conditions in Thai.
8. WHEN the same Order and the same fixture data are proposed twice, THE Lot_Planner SHALL return the same Plots and the same Queue_Slots in the same order.
9. IF no eligible Plot exists for the Lot, THEN THE Lot_Planner SHALL return zero Plots, SHALL report a shortfall equal to Target_Tons, SHALL NOT assign a queue, and THE Demo_Web SHALL display a message that no eligible Plot was found.

### Requirement 6: ต้นทุนส่งถึงโรงงาน

**User Story:** As a Coordinator, I want a delivered cost per ton shown apart from the plant's offer, so that the two numbers are not confused.

#### Acceptance Criteria

1. WHEN the Coordinator selects one or more Plots, THE Lot_Planner SHALL compute Delivered_Cost as (ราคาฟางที่จ่ายเกษตรกร + ค่าอัดฟ่อน + ค่าขนส่ง) ÷ Estimated_Tons, using the rates of assumption A1 and the rounding of assumption A13.
2. WHEN the Lot_Planner computes the haulage amount, THE Lot_Planner SHALL calculate it as the sum over selected Plots of expected tons × distance in km × haulage rate per ton-km.
3. WHEN the Coordinator adds or removes a Plot, THE Lot_Planner SHALL recompute Delivered_Cost from the new selection in the same response.
4. WHEN Delivered_Cost is available, THE Demo_Web SHALL display it in baht per ton labeled «ต้นทุนส่งถึงโรงงาน (ประมาณการ)» and SHALL display Plant_Offer_Price in a separate element labeled «ราคาที่โรงงานเสนอ».
5. THE Demo_Web SHALL NOT display a profit, margin, or income figure for any Farmer.
6. IF Estimated_Tons is zero, THEN THE Lot_Planner SHALL report no Delivered_Cost without raising a division-by-zero error, and THE Demo_Web SHALL show a message that no tonnage is selected in place of the cost.
7. FOR ALL selections of Plots with Estimated_Tons greater than zero, THE Lot_Planner SHALL produce a Delivered_Cost that is not below the sum of the straw price rate and the baling rate (metamorphic property).

### Requirement 7: ปรับชุดแปลงและตรวจซ้ำทันที

**User Story:** As a Coordinator, I want to adjust the plot set and see the result at once, so that I can fix a shortfall before asking for confirmation.

#### Acceptance Criteria

1. WHEN the Coordinator adds an eligible Plot to a Lot or removes a selected Plot from a Lot, THE Lot_Planner SHALL recompute Estimated_Tons, the queue selection, Delivered_Cost, and the shortfall, and THE Lot_Service SHALL return all four values in the same response.
2. IF the Coordinator adds a Plot that the eligibility rules exclude, THEN THE Lot_Service SHALL reject the change with HTTP 422 and the exclusion reason, and SHALL leave the Plot set, Estimated_Tons, queue selection, and Delivered_Cost unchanged.
3. IF Estimated_Tons is below Target_Tons after a change, THEN THE Demo_Web SHALL display «ขาด X ตัน», where X is Target_Tons minus Estimated_Tons rounded to 2 decimal places.
4. IF no Queue_Slot pair meets the conditions after a change, THEN THE Demo_Web SHALL display the failing condition named by requirement 5.7.
5. WHEN the Coordinator selects a different baling or haul Queue_Slot, THE Lot_Service SHALL accept the slot only when requirement 5.3 holds for the current selection.
6. IF the Coordinator selects a Queue_Slot for which requirement 5.3 does not hold, THEN THE Lot_Service SHALL reject the change with the failing condition and SHALL keep the previously selected Queue_Slot pair unchanged.
7. WHEN the Coordinator changes the Plant_Offer_Price of an Order, THE Lot_Service SHALL apply the price validation of requirement 3.1 and SHALL return the recomputed Delivered_Cost and shortfall in the same response.
8. IF the submitted Plant_Offer_Price fails the validation of requirement 3.1, THEN THE Lot_Service SHALL reject the change with HTTP 422 and the failure reason and SHALL keep the previous Plant_Offer_Price unchanged.
9. IF the Lot has Lot_Status «ปิดล็อต», THEN THE Lot_Service SHALL reject every edit to Plots, price, or queue with HTTP 409 and SHALL leave the Lot unchanged.
10. WHILE the Lot has Lot_Status «ปิดล็อต», THE Lot_Service SHALL continue to return the Lot data (Plots, price, queue, Confirmations, and weights) for viewing.

### Requirement 8: ส่งให้ยืนยัน

**User Story:** As a Coordinator, I want to move a lot from draft to waiting for confirmation only when it can be fulfilled, so that parties are not asked to confirm an impossible plan.

#### Acceptance Criteria

1. WHEN the Coordinator submits a Lot in Lot_Status «ร่าง» for confirmation, AND Estimated_Tons is greater than or equal to Target_Tons, AND both Queue_Slots are selected and feasible, THE Lot_Service SHALL change Lot_Status to «รอยืนยัน».
2. IF Estimated_Tons is less than Target_Tons, THEN THE Lot_Service SHALL reject the transition with HTTP 422, SHALL report the shortfall in tons rounded to 2 decimal places, and SHALL leave Lot_Status as «ร่าง».
3. IF one or both Queue_Slots are not selected or are infeasible, THEN THE Lot_Service SHALL reject the transition with HTTP 422, SHALL identify each failing Queue_Slot and whether it is missing or infeasible, and SHALL leave Lot_Status as «ร่าง».
4. WHEN the Lot enters «รอยืนยัน», THE Lot_Service SHALL create exactly one pending Confirmation for the Plant, exactly one for each distinct Farmer who owns at least one selected Plot, and exactly one for the Contractor, in the same operation as the status change.
5. IF the Coordinator requests a transition that is not defined for the current Lot_Status, THEN THE Lot_Service SHALL reject it with HTTP 409, SHALL leave Lot_Status unchanged, and SHALL create no Confirmation.

### Requirement 9: บันทึกการยืนยันและพร้อมดำเนินงาน

**User Story:** As a Coordinator, I want to see who has not confirmed and have the lot become ready automatically when everyone has, so that I know the next step.

#### Acceptance Criteria

1. WHEN the Coordinator records a Confirmation for the Plant or for a Farmer while Lot_Status is «รอยืนยัน», THE Lot_Service SHALL mark that Confirmation as confirmed with the recording time and SHALL return the count of confirmed parties out of the total in the same response.
2. WHEN the Coordinator records the Contractor Confirmation with a baling date and a haul date that equal the selected Queue_Slot dates while Lot_Status is «รอยืนยัน», THE Lot_Service SHALL mark the Contractor Confirmation as confirmed with the recording time.
3. IF the Contractor baling date or haul date differs from the selected Queue_Slot dates, or either date is missing or not a valid calendar date, THEN THE Lot_Service SHALL reject the Confirmation with HTTP 422, SHALL state that the queue must be edited first, and SHALL leave the Contractor Confirmation and Lot_Status unchanged.
4. WHILE Lot_Status is «รอยืนยัน», THE Demo_Web SHALL list each party that has not confirmed by name and role, and SHALL show the count of confirmed parties out of the total in the form "N/M".
5. WHEN a recorded Confirmation causes every Confirmation of the Lot to be confirmed, THE Lot_Service SHALL change Lot_Status to «พร้อมดำเนินงาน» in the same response, and SHALL NOT change Lot_Status while at least one Confirmation is pending.
6. IF the Coordinator records a Confirmation while Lot_Status is not «รอยืนยัน», THEN THE Lot_Service SHALL reject it with HTTP 409 and SHALL leave the Lot unchanged, including a repeated Confirmation on a Lot in «พร้อมดำเนินงาน».
7. WHEN the Coordinator records a Confirmation that is already confirmed while Lot_Status is «รอยืนยัน», THE Lot_Service SHALL leave the Lot unchanged, including the original recording time, and SHALL return success (idempotence).
8. THE Demo_Web SHALL label each recorded Confirmation as «บันทึกโดยผู้ประสานงาน» and SHALL NOT display any text stating or implying that a message was sent to any party.
9. IF the Coordinator records a Confirmation for a party that is not part of the Lot, THEN THE Lot_Service SHALL reject it with HTTP 404 and SHALL leave the Lot unchanged.

### Requirement 10: ต้องยืนยันใหม่เมื่อมีการแก้ไข

**User Story:** As a Coordinator, I want edits after confirmation to reset the confirmations, so that nobody is committed to a plan they did not agree to.

#### Acceptance Criteria

1. WHEN the Coordinator changes the selected Plots, the Plant_Offer_Price, the Queue_Slots, or a Plot moisture value while Lot_Status is «รอยืนยัน» or «พร้อมดำเนินงาน», and the edited Lot still satisfies Estimated_Tons ≥ Target_Tons with every Queue_Slot feasible, THE Lot_Service SHALL set every Confirmation to pending, SHALL set Lot_Status to «รอยืนยัน», and SHALL increase Revision by exactly 1.
2. WHEN a re-confirmation reset happens, THE Demo_Web SHALL display the field that was changed and the name of every party whose Confirmation was reset to pending.
3. IF an edit made while Lot_Status is «รอยืนยัน» or «พร้อมดำเนินงาน» leaves Estimated_Tons below Target_Tons or leaves any Queue_Slot infeasible, THEN THE Lot_Service SHALL save the edit, set every Confirmation to pending, set Lot_Status to «ร่าง», increase Revision by exactly 1, and return each failing condition.
4. WHEN the Coordinator edits a Lot in Lot_Status «ร่าง», THE Lot_Service SHALL save the edit, keep Lot_Status «ร่าง», and increase Revision by exactly 1.
5. IF an edit request does not change any value, THEN THE Lot_Service SHALL leave Lot_Status, Confirmations, and Revision unchanged and THE Demo_Web SHALL NOT display a re-confirmation reset notice.
6. IF an edit request contains an invalid value (a Plot the eligibility rules exclude, an invalid Plant_Offer_Price, a moisture value outside 0 to 100 percent, or a Queue_Slot that is not a valid slot), THEN THE Lot_Service SHALL reject the whole edit, SHALL leave Lot_Status, Confirmations, and Revision unchanged, and SHALL name each invalid field.

### Requirement 11: บันทึกน้ำหนักจริงและปิดล็อต

**User Story:** As a Coordinator, I want to record the weighed tons at delivery and see them next to the target and the estimate, so that the closing figures are clear.

#### Acceptance Criteria

1. WHEN a Coordinator submits an Actual_Tons value while Lot_Status is «พร้อมดำเนินงาน» and the value is a finite number greater than 0 and not above 100, THE Lot_Service SHALL store the value rounded to 2 decimal places as the Lot's Actual_Tons.
2. IF a Coordinator submits an Actual_Tons value while Lot_Status is not «พร้อมดำเนินงาน», THEN THE Lot_Service SHALL reject the submission with HTTP 409 and SHALL leave the Lot unchanged, and THE Demo_Web SHALL display that the Lot cannot accept a weight in its current status.
3. IF a Coordinator submits an Actual_Tons value that is empty, non-numeric, NaN, infinite, 0 or below, or above 100, THEN THE Lot_Service SHALL reject the submission with HTTP 422 and SHALL leave the Lot unchanged, and THE Demo_Web SHALL display that the weight must be greater than 0 and not above 100 tons.
4. WHEN the Lot_Service accepts an Actual_Tons value that is greater than or equal to Target_Tons, THE Lot_Service SHALL set Lot_Status to «ปิดล็อต» in the same operation that stores Actual_Tons.
5. WHEN the Lot_Service accepts an Actual_Tons value that is below Target_Tons, THE Lot_Service SHALL keep Lot_Status as «พร้อมดำเนินงาน» and SHALL handle the shortfall under requirement 12.
6. WHEN a Lot is closed with Actual_Tons 10.4 for Target_Tons 10 and Estimated_Tons 12, THE Demo_Web SHALL display «ออเดอร์ 10 ตัน · ประมาณการ 12 ตัน · รับจริง 10.4 ตัน».
7. WHEN the Demo_Web displays a Lot that has an Actual_Tons value, THE Demo_Web SHALL display Target_Tons, Estimated_Tons, and Actual_Tons as three separate labeled values, with trailing zeros omitted.
8. WHILE Lot_Status is «ปิดล็อต», THE Demo_Web SHALL offer exactly two actions, viewing the result and starting a new Order, and SHALL NOT offer any control to submit or edit Actual_Tons.

### Requirement 12: ปริมาณจริงต่ำกว่าเป้าหมาย

**User Story:** As a Coordinator, I want to record what happens when the delivered amount is below the order, so that the shortfall is not lost.

#### Acceptance Criteria

1. IF an accepted Actual_Tons is below Target_Tons, THEN THE Lot_Service SHALL keep Lot_Status «พร้อมดำเนินงาน», SHALL return the shortfall as Target_Tons minus Actual_Tons rounded to 2 decimal places, and SHALL mark the shortfall decision as pending.
2. WHILE a shortfall decision is pending, THE Lot_Service SHALL accept a further Actual_Tons submission that replaces the stored value and recomputes the shortfall, and WHEN that value is not below Target_Tons, SHALL set Lot_Status to «ปิดล็อต» and clear the pending decision.
3. WHEN the shortfall is returned, THE Demo_Web SHALL display «ขาด X ตัน», where X is the shortfall with 2 decimal places, and SHALL display exactly two options, «โรงงานรับตามจริง» and «ต้องหาเพิ่ม».
4. WHEN the Coordinator chooses «โรงงานรับตามจริง» while a shortfall decision is pending, THE Lot_Service SHALL set Lot_Status to «ปิดล็อต», SHALL record that the Plant accepts Actual_Tons, SHALL record 0 tons still to be sourced, and SHALL mark the decision as resolved.
5. WHEN the Coordinator chooses «ต้องหาเพิ่ม» while a shortfall decision is pending, THE Lot_Service SHALL set Lot_Status to «ปิดล็อต», SHALL record the shortfall in tons as quantity still to be sourced, and SHALL mark the decision as resolved.
6. IF the Coordinator submits a choice while no shortfall decision is pending, THEN THE Lot_Service SHALL reject it with HTTP 409, SHALL leave the Lot unchanged, and THE Demo_Web SHALL display that no shortfall decision is pending.
7. WHILE a shortfall decision is pending, THE Demo_Web SHALL display the two decision options as the next action, and SHALL keep them displayed after the page is reloaded.

### Requirement 13: สถานะต่อ session และการเก็บข้ามการรีเฟรช

**User Story:** As a demo participant, I want my demo data kept across page refreshes and kept apart from other people's, so that several people can try at the same time.

#### Acceptance Criteria

1. IF a request arrives without a Session token, THEN THE Session_Store SHALL create a new Session with fresh fixture data and SHALL return a new token of at least 128 bits of randomness.
2. THE Session_Store SHALL keep every Order, Lot, Confirmation, and Plot edit separate for each Session, so that a read or write in one Session never returns or changes data belonging to another Session.
3. WHEN the Demo_Web page is reloaded within the same Session, THE Demo_Web SHALL show the same Order, Lot, Lot_Status, and next action as before the reload.
4. WHEN two Sessions edit their Lots at the same time, THE Session_Store SHALL apply each edit only to the Lot of its own Session and SHALL leave the Lot of the other Session unchanged.
5. THE Lot_Service SHALL include a Revision number, a non-negative integer that increases by 1 on every accepted write that changes a value, in every Lot response.
6. IF a write request carries a Revision that differs from the current Revision of the Lot, THEN THE Lot_Service SHALL reject it with HTTP 409, SHALL leave the Lot and its Revision unchanged, and SHALL return an error indicating that the Lot was changed by another edit.
7. THE Session_Store SHALL serialize the Lot state to JSON and restore it, and FOR ALL valid Lot states, serializing, restoring, and serializing again SHALL produce a state equal to the first serialized state (round-trip property).
8. WHEN a Session has had no request for 24 hours, THE Session_Store SHALL remove that Session and all Orders, Lots, Confirmations, and Plot edits in it.
9. THE Session_Store SHALL hold no data about a real person and SHALL NOT use the LINE userId as a key.
10. IF a Session token is invalid, malformed, or expired, THEN THE Session_Store SHALL create a new Session with fresh fixture data and THE Demo_Web SHALL show the Coordinator a Thai message that the demo data was reset and SHALL block interaction with the new fixture data until the Coordinator dismisses the message.

### Requirement 14: หน้าเว็บภาษาไทยแบบ mobile-first และ LIFF

**User Story:** As a Coordinator or Farmer, I want one clear Thai mobile page that works in a browser and in LINE, so that I always know the status and next action.

#### Acceptance Criteria

1. THE Demo_Web SHALL present all labels, messages, and statuses in Thai, except proper nouns, units of measure, and numerals.
2. WHILE the viewport width is 360 px to 430 px, THE Demo_Web SHALL show every control and value with a document scroll width no greater than the viewport width, so that no horizontal scrolling is needed.
3. WHEN the lot screen is displayed, THE Demo_Web SHALL show the current Lot_Status and exactly one primary next action, visible without vertical scrolling at a viewport height of 640 px.
4. THE Demo_Web SHALL provide a touch target of at least 44 × 44 CSS px for every button and form control.
5. WHEN a user opens the Demo_Web in a plain browser, THE Demo_Web SHALL complete every feature without requiring LINE login.
6. WHERE the environment variable `LIFF_ID` is set, THE Demo_Web SHALL load the LIFF SDK and initialize LIFF with that ID on the same page.
7. IF the LIFF SDK fails to load or fails to initialize within 10 seconds, THEN THE Demo_Web SHALL show «เชื่อมต่อ LINE ไม่สำเร็จ คุณยังใช้งานผ่านเว็บได้», SHALL keep every feature usable, and SHALL retain all entered values.
8. IF a request fails because of a network error or does not respond within 15 seconds, THEN THE Demo_Web SHALL keep all entered values, SHALL show a Thai message stating that the request failed, and SHALL show a retry control that resends the request with the retained values when activated.
9. THE Demo_Web SHALL label every figure derived from assumptions A1 to A4 with «ประมาณการ» or «ข้อมูลจำลอง», placed adjacent to the figure.
10. THE Demo_Web SHALL render untrusted text from user input and from server responses as plain text, so that HTML markup in that text is displayed literally and is not executed.

### Requirement 15: การรันโดยไม่ใช้ AWS และไม่กระทบ CLI agent

**User Story:** As a team member, I want to run the demo with no cloud setup, so that anyone can try it quickly.

#### Acceptance Criteria

1. WHEN a team member starts the Demo_Web on Python 3.12 or later with no AWS credentials configured and no network access, THE Demo_Web SHALL start and serve every feature of requirements 1 to 13 with the same results as when network access is available.
2. IF the LIFF SDK fails to load or network access is unavailable, THEN THE Demo_Web SHALL continue to serve all features in non-LINE mode, as required by requirement 14.7.
3. THE Demo_Web SHALL limit the dependencies of the web server to the Python standard library, except for one optional WSGI server used only for deployment and not required for local startup.
4. THE project SHALL keep `agent.py` and `check_bedrock.py` unchanged in behavior.
5. THE README SHALL state that the web demo uses server-side rules and mock data, that the CLI agent is separate, and that the CLI agent requires Bedrock access in ap-southeast-1.
6. THE Demo_Web SHALL contain no payment function, no carbon-credit trading or claim function, and no function that sends a real LINE message.
7. THE Lot_Planner SHALL implement the planning and cost rules as pure functions that return identical output for identical input, run without starting a server, and perform no network, file, or clock access, so that automated tests can call them directly.

### Requirement 16: สถานการณ์ยอมรับ

**User Story:** As a reviewer, I want the acceptance scenarios to be repeatable tests, so that I can verify the demo end to end.

#### Acceptance Criteria

1. WHEN a test runs scenario (a) at a mobile viewport of 360 px width by 640 px height with an Order for 10 tons of rice straw and mock Plots of 4, 3, and 5 tons, THE Demo_Web SHALL show that more than one Plot is needed, SHALL accept Confirmations from the Plant, all three Farmers, and the Contractor, SHALL reach «พร้อมดำเนินงาน», and SHALL close with Actual_Tons 10.4 displaying «ออเดอร์ 10 ตัน · ประมาณการ 12 ตัน · รับจริง 10.4 ตัน».
2. IF a test runs scenario (b) with a Plot whose last clearing date is before every feasible baling date, or with a Queue_Slot that cannot meet the delivery date, THEN THE Lot_Service SHALL report only the first failing condition found, in the check order ready date, last clearing date, delivery date, queue capacity, by naming the Plot or Queue_Slot and the violated date constraint, SHALL reject «ส่งให้ยืนยัน», and SHALL keep the Lot in its prior status with no Confirmation created.
3. IF a test runs scenario (b) with exactly one required Confirmation missing, THEN THE Demo_Web SHALL list that party by name as pending and THE Lot_Service SHALL keep the Lot in «รอยืนยัน».
4. WHEN a test edits a Plot after every Confirmation is recorded, THE Lot_Service SHALL return the Lot to «รอยืนยัน» and SHALL set every Confirmation to pending.
5. WHEN a test records Actual_Tons below Target_Tons, THE Demo_Web SHALL show the shortfall in tons, equal to Target_Tons minus Actual_Tons, and SHALL show both decision options of requirement 12.3.
6. WHEN a test runs scenario (c), THE Search_Service SHALL return the F3 results of requirement 1.
7. IF a test simulates a load failure during scenario (c), THEN THE Demo_Web SHALL show the retry control of requirement 2.5 and, WHEN the test activates it and the load succeeds, THE Demo_Web SHALL display the F3 results without a page reload.
8. THE project SHALL include automated tests covering each acceptance criterion of requirements 1 to 13, including property-based tests, each running at least 100 generated cases, for the ordering rule, the 80 km boundary (distances of exactly 80 km and above 80 km), the Delivered_Cost formula, the status transition rules, and the Lot state round trip.
9. THE project SHALL keep the test fixtures free of real personal data, using only names, phone numbers, LINE identifiers, and coordinates that are synthetic and labeled as mock.

### Requirement 17: ผลส่งมอบ การ deploy และการตั้งค่า LINE

**User Story:** As a team member, I want run, deploy, and LINE setup instructions with honest test results, so that I know what has and has not been verified.

#### Acceptance Criteria

1. THE README SHALL state the local run command, the minimum Python version (3.12), and the full local URL (including host and port) to open in a browser.
2. THE README SHALL describe one HTTPS deployment method that runs the Python WSGI application, and SHALL state the start command, the `LIFF_ID` environment variable name, and the step that sets its value.
3. THE README SHALL describe the steps to set the Endpoint URL of the LIFF app in the LINE Developers Console to the HTTPS root URL of the deployed page, and SHALL state that the URL must start with `https://`.
4. THE project SHALL include a test report that lists each command run, the number of tests passed, failed, and skipped, the run date, and a summary of the actual output of up to 20 lines per command.
5. IF no HTTPS endpoint or no LIFF ID is available when the work is reported, THEN THE test report SHALL state that testing reached local HTTP and browser or viewport checks only, and that opening the page inside LINE was not tested.
6. THE test report SHALL list results under three separate headings: verified results (checks that were run and observed), assumptions (statements not checked by a run), and untested items (checks not run).
7. IF any test in the reported commands failed, THEN THE test report SHALL list each failed test by name with its failure output summary, and SHALL NOT report the failed tests as passed or omit them.
8. WHEN the README is followed on a machine with the stated Python version and no LIFF ID set, THE README SHALL state the expected behavior of the page, so that a team member can tell a correct local run from a failed one.
