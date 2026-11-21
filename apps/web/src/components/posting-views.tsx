import Link from 'next/link';
import type { BalingService, PurchaseDemand } from '@agrimatch/contracts';
import { formatDateTime, formatKg } from '@/lib/format';
import {
  demandSummary,
  FORM_LABEL,
  materialsText,
  qualityLines,
  SERVICE_MODE_LABEL,
  serviceSummary,
  TRANSPORT_LABEL,
  VERIFY_LABEL,
  windowText,
} from '@/lib/postings';
import { Card, CardList, Field } from './cards';
import { StatusBadge } from './feedback';

export function DemandCards({ items }: { items: PurchaseDemand[] }) {
  return (
    <CardList label="ความต้องการรับซื้อ">
      {items.map((d) => {
        const s = demandSummary(d);
        return (
          <Card key={d.id} title={<Link href={`/demands/${d.id}`} className="inline-flex min-h-11 items-center text-emerald-800 underline">{materialsText(d.accepted_materials)}</Link>} badge={<StatusBadge status={d.status} />}>
            <dl className="space-y-1">
              <Field label="ต้องการ">{s.target}</Field>
              <Field label="คงเหลือ">{s.remaining}</Field>
              <Field label="ราคา">{s.price}</Field>
              <Field label="จังหวัด">{d.province ?? '-'}</Field>
            </dl>
          </Card>
        );
      })}
    </CardList>
  );
}

export function DemandDetail({ d }: { d: PurchaseDemand }) {
  const s = demandSummary(d);
  const q = qualityLines(d.quality);
  return (
    <dl className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm" aria-label="รายละเอียดความต้องการรับซื้อ">
      <Field label="สถานะ"><StatusBadge status={d.status} /></Field>
      <Field label="วัสดุ">{materialsText(d.accepted_materials)}</Field>
      <Field label="รูปแบบ">{d.accepted_forms.length ? d.accepted_forms.map((x) => FORM_LABEL[x]).join(', ') : 'ไม่ระบุ'}</Field>
      <Field label="ต้องการทั้งหมด">{s.target}</Field>
      <Field label="ตกลงแล้ว">{formatKg(d.committed_qty_kg)}</Field>
      <Field label="คงเหลือ">{s.remaining}</Field>
      <Field label="ขั้นต่ำต่อรอบ">{d.min_lot_kg ? formatKg(d.min_lot_kg) : 'ไม่ระบุ'}</Field>
      <Field label="ราคา">{s.price}</Field>
      <Field label="จังหวัด">{[d.district, d.province].filter(Boolean).join(' ') || '-'}</Field>
      <Field label="รัศมีรับซื้อ">{d.radius_km ? `${d.radius_km} กม.` : 'ไม่ระบุ'}</Field>
      <Field label="จังหวัดที่รับ">{d.accepted_provinces.join(', ') || 'ไม่ระบุ'}</Field>
      <Field label="ช่วงเวลา">{windowText(d.window_from, d.window_to)}</Field>
      <Field label="การขนส่ง">{TRANSPORT_LABEL[d.transport_by]}</Field>
      <Field label="รับวัสดุที่ยังไม่พร้อม">{d.accepts_pending_material ? 'รับ' : 'ไม่รับ'}</Field>
      <Field label="เงื่อนไขคุณภาพ">
        {q.length ? (
          <ul>
            {q.map((l) => (
              <li key={l.label}>
                {l.label}: {l.value}
                {l.needsVerify ? <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-900">{VERIFY_LABEL}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          'ไม่ระบุ'
        )}
      </Field>
      <Field label="สร้างเมื่อ">{formatDateTime(d.created_at)}</Field>
    </dl>
  );
}

export function ServiceCards({ items }: { items: BalingService[] }) {
  return (
    <CardList label="บริการรับจ้างอัด">
      {items.map((b) => {
        const s = serviceSummary(b);
        return (
          <Card key={b.id} title={<Link href={`/services/${b.id}`} className="inline-flex min-h-11 items-center text-emerald-800 underline">{materialsText(b.material_types)}</Link>} badge={<StatusBadge status={b.status} />}>
            <dl className="space-y-1">
              <Field label="รูปแบบ">{SERVICE_MODE_LABEL[b.service_mode]}</Field>
              <Field label="ค่าบริการ">{s.price}</Field>
              <Field label="กำลังอัด">{s.capacity}</Field>
              <Field label="จังหวัด">{b.province ?? '-'}</Field>
            </dl>
          </Card>
        );
      })}
    </CardList>
  );
}

export function ServiceDetail({ b }: { b: BalingService }) {
  const s = serviceSummary(b);
  return (
    <dl className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm" aria-label="รายละเอียดบริการรับจ้างอัด">
      <Field label="สถานะ"><StatusBadge status={b.status} /></Field>
      <Field label="วัสดุที่รับอัด">{materialsText(b.material_types)}</Field>
      <Field label="รูปแบบบริการ">{SERVICE_MODE_LABEL[b.service_mode]}</Field>
      <Field label="รูปแบบก้อน">{b.baling_format ?? 'ไม่ระบุ'}</Field>
      <Field label="ปริมาณขั้นต่ำ">{b.min_qty_kg ? formatKg(b.min_qty_kg) : 'ไม่ระบุ'}</Field>
      <Field label="กำลังอัดต่อรอบ">{s.capacity}</Field>
      <Field label="ค่าบริการ">{s.price}</Field>
      <Field label="จังหวัด">{[b.district, b.province].filter(Boolean).join(' ') || '-'}</Field>
      <Field label="จังหวัดที่ให้บริการ">{b.service_provinces.join(', ') || 'ไม่ระบุ'}</Field>
      <Field label="ช่วงเวลา">{windowText(b.available_from, b.available_to)}</Field>
      <Field label="การขนส่ง">{TRANSPORT_LABEL[b.transport_by]}</Field>
      <Field label="สร้างเมื่อ">{formatDateTime(b.created_at)}</Field>
    </dl>
  );
}
