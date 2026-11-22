import { Card, GREEN, PageHead } from '@/components/factory/ui';

const F = 'mt-1 w-full rounded-lg border border-[#e5eae3] px-3 py-2 text-sm';
export default function SettingsPage() {
  return (
    <>
      <PageHead title="ตั้งค่าโรงงาน" sub="จัดการข้อมูลบริษัทและการแจ้งเตือน" action={<button className={`rounded-lg px-4 py-2 text-sm ${GREEN}`}>บันทึก</button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h2 className="mb-3 font-semibold text-[#17402a]">ข้อมูลบริษัท</h2>
          <label className="block text-sm">ชื่อบริษัท<input className={F} defaultValue="บริษัท กรีนเอ็นเนอร์จี จำกัด" /></label>
          <label className="mt-3 block text-sm">ที่อยู่โรงงาน<input className={F} defaultValue="อ.กำแพงแสน จ.นครปฐม" /></label>
          <label className="mt-3 block text-sm">เบอร์ติดต่อ<input className={F} defaultValue="02-123-4567" /></label></Card>
        <Card><h2 className="mb-3 font-semibold text-[#17402a]">วัสดุที่รับซื้อ</h2>
          {['แกลบ', 'ฟางข้าว', 'ซังข้าวโพด', 'กะลาปาล์ม', 'เศษไม้'].map((m, i) => <label key={m} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={i !== 1} />{m}</label>)}
          <h2 className="mb-2 mt-5 font-semibold text-[#17402a]">การแจ้งเตือน</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked />แจ้งเตือนผ่าน LINE เมื่อมีผลจับคู่ใหม่</label></Card>
      </div>
    </>
  );
}
