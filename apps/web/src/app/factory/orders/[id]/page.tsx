import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, PageHead, Pill, Thumb } from '@/components/factory/ui';
import { ORDERS, baht } from '@/lib/factory-mock';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = ORDERS.find((x) => x.id === id);
  if (!o) notFound();
  return (
    <>
      <Link href="/factory/orders" className="text-xs text-[#1f6b43]">← กลับไปคำสั่งซื้อ</Link>
      <PageHead title={`คำสั่งซื้อ ${o.code}`} sub={`สั่งซื้อเมื่อ ${o.date}`} action={<Pill status={o.status} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold text-[#17402a]">รายการสินค้า</h2>
          <div className="flex gap-4"><Thumb tone={o.tone} className="h-28 w-40 rounded-lg" />
            <div className="flex-1"><p className="font-semibold">{o.material}</p><p className="text-sm text-slate-500">{o.seller} · {o.from}</p></div>
            <div className="text-right text-sm"><p>{o.price.toLocaleString()} บาท/ตัน</p><p className="text-slate-500">จำนวน {o.qty} ตัน</p></div></div>
          <div className="mt-5 flex justify-between border-t pt-4 text-lg font-bold"><span>รวมราคาทั้งหมด</span><span>{baht(o.qty * o.price)}</span></div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-[#17402a]">ข้อมูลการจัดส่ง</h2>
          <dl className="space-y-3 text-sm"><div><dt className="text-xs text-slate-400">ผู้ขาย</dt><dd>{o.seller}</dd></div>
            <div><dt className="text-xs text-slate-400">ต้นทาง</dt><dd>{o.from}</dd></div>
            <div><dt className="text-xs text-slate-400">ปลายทาง</dt><dd>บริษัท กรีนเอ็นเนอร์จี จำกัด จ.นครปฐม</dd></div>
            <div><dt className="text-xs text-slate-400">หมายเหตุ</dt><dd>แจ้งก่อนถึง 30 นาที</dd></div></dl>
        </Card>
      </div>
    </>
  );
}
