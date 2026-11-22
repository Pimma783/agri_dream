import { Card, PageHead } from '@/components/factory/ui';

const FAQ = [
  ['ลงประกาศรับซื้อได้อย่างไร?', 'ไปที่ตลาดวัสดุ แล้วกด “ประกาศรับซื้อ” กรอกชนิด ปริมาณ และราคาที่ต้องการ'],
  ['ระบบจับคู่ผู้ขายอย่างไร?', 'ระบบพิจารณาชนิดวัสดุ ระยะทาง ราคา และความชื้น แล้วแจ้งผลผ่านกระดิ่งและ LINE'],
  ['ติดตามการจัดส่งได้ที่ไหน?', 'เมนูการจัดส่ง แสดงสถานะและเวลาที่คาดว่าจะถึง'],
  ['ติดต่อทีมงานได้ทางไหน?', 'ส่งข้อความผ่าน LINE Official Account ของ Agrimatch ได้ตลอดเวลา'],
];
export default function HelpPage() {
  return (
    <>
      <PageHead title="ศูนย์ช่วยเหลือ" sub="คำถามที่พบบ่อยและช่องทางติดต่อ" />
      <div className="space-y-3">{FAQ.map(([q, a]) => <Card key={q}><details><summary className="cursor-pointer font-semibold text-[#17402a]">{q}</summary><p className="mt-2 text-sm text-slate-600">{a}</p></details></Card>)}</div>
    </>
  );
}
