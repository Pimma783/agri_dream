import Link from 'next/link';
import type { AgreementView, OfferView } from '@agrimatch/contracts';
import { formatDate, formatDateTime, formatKg } from '@/lib/format';
import {
  AGREEMENT_NOTICE,
  AGREEMENT_STATUS_TEXT,
  OFFER_KIND_LABEL,
  priceText,
  remainingKg,
  totalText,
  TRANSPORT_BY_LABEL,
  transportCostText,
} from '@/lib/offers';
import { BUTTON_CLASS, Card, CardList, Field } from './cards';
import { Notice, StatusBadge } from './feedback';

const DIRECTION_LABEL = { sent: 'ส่งแล้ว', received: 'ได้รับ' } as const;

export function OfferCards({ items }: { items: OfferView[] }) {
  return (
    <CardList label="ข้อเสนอ">
      {items.map((o) => (
        <Card key={o.id} title={`${OFFER_KIND_LABEL[o.kind]} · ${DIRECTION_LABEL[o.direction]}`} badge={<StatusBadge status={o.status} />}>
          <p>{formatKg(o.qty_kg)} · {priceText(o.unit_price_thb, o.price_unit)}</p>
          {o.status === 'PENDING' ? <p className="text-xs text-slate-600">หมดอายุ {formatDateTime(o.expires_at)}</p> : null}
          <Link href={`/offers/${encodeURIComponent(o.id)}`} className={`${BUTTON_CLASS} w-full`}>
            ดูข้อเสนอ
          </Link>
        </Card>
      ))}
    </CardList>
  );
}

/** Terms. The total is shown only when the API computed it; transport cost stays a separate line. */
export function OfferTerms({ o }: { o: OfferView }) {
  return (
    <dl className="space-y-2 text-sm">
      <Field label="ประเภท">{OFFER_KIND_LABEL[o.kind]}</Field>
      <Field label="ปริมาณ">{formatKg(o.qty_kg)}</Field>
      <Field label="ราคาที่เสนอ">{priceText(o.unit_price_thb, o.price_unit)}</Field>
      <Field label="ยอดรวม">
        <span data-testid="offer-total">{totalText(o.total_amount_thb)}</span>
      </Field>
      <Field label="การขนส่ง">{TRANSPORT_BY_LABEL[o.transport_by]}</Field>
      <Field label="ค่าขนส่ง">
        <span data-testid="offer-transport-cost">{transportCostText(o.transport_cost_thb)}</span>
      </Field>
      {o.ready_date ? <Field label="วันที่พร้อม">{formatDate(o.ready_date)}</Field> : null}
      <Field label="หมดอายุ (เวลาไทย)">{formatDateTime(o.expires_at)}</Field>
    </dl>
  );
}

export function OfferDetail({ o }: { o: OfferView }) {
  return (
    <div className="space-y-4">
      <section aria-label="ข้อเสนอ" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold">{DIRECTION_LABEL[o.direction]}</h2>
          <StatusBadge status={o.status} />
        </div>
        <OfferTerms o={o} />
        {o.ack_pending_material ? (
          <p data-testid="ack-note" className="text-xs text-amber-900">ผู้ส่งรับทราบแล้วว่าวัสดุยังอยู่ระหว่างรอรับหรือรออัด</p>
        ) : null}
        {o.is_demo ? <p className="text-xs text-slate-600">ข้อมูลตัวอย่างสำหรับเดโม</p> : null}
      </section>
      <section aria-label="ประวัติ" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">ประวัติ</h2>
        <ul className="space-y-1 text-sm">
          <li>สร้างเมื่อ {formatDateTime(o.created_at)}</li>
          {o.supersedes_offer_id ? (
            <li>
              แก้ไขจาก{' '}
              <Link className="underline" href={`/offers/${encodeURIComponent(o.supersedes_offer_id)}`}>ข้อเสนอเดิม</Link>
            </li>
          ) : null}
          <li>สถานะตอนนี้: <StatusBadge status={o.status} /></li>
        </ul>
      </section>
    </div>
  );
}

export function AgreementNotice() {
  return (
    <Notice tone="warning">
      <span data-testid="agreement-notice">{AGREEMENT_NOTICE}</span>
    </Notice>
  );
}

export function AgreementCards({ items }: { items: AgreementView[] }) {
  return (
    <CardList label="ข้อตกลง">
      {items.map((a) => (
        <Card key={a.id} title={OFFER_KIND_LABEL[a.kind]} badge={<StatusBadge status={a.status} />}>
          <p>{AGREEMENT_STATUS_TEXT[a.status]} · {formatKg(a.qty_kg)}</p>
          <p className="text-xs text-slate-600">ยืนยันเมื่อ {formatDateTime(a.confirmed_at)}</p>
          <Link href={`/agreements/${encodeURIComponent(a.id)}`} className={`${BUTTON_CLASS} w-full`}>
            ดูข้อตกลง
          </Link>
        </Card>
      ))}
    </CardList>
  );
}

export function AgreementDetail({ a, side }: { a: AgreementView; side: 'buyer' | 'seller' }) {
  const purchase = a.kind === 'PURCHASE';
  return (
    <div className="space-y-4">
      <AgreementNotice />
      <section aria-label="ข้อตกลง" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold">{AGREEMENT_STATUS_TEXT[a.status]}</h2>
          <StatusBadge status={a.status} />
        </div>
        <dl className="space-y-2 text-sm">
          <Field label="ประเภท">{OFFER_KIND_LABEL[a.kind]}</Field>
          <Field label="บทบาทของคุณ">{side === 'buyer' ? (purchase ? 'ผู้ซื้อ' : 'ผู้ใช้บริการ') : purchase ? 'ผู้ขาย' : 'ผู้ให้บริการ'}</Field>
          <Field label="ปริมาณตามข้อตกลง">{formatKg(a.qty_kg)}</Field>
          <Field label="ราคาที่ตกลง">{priceText(a.unit_price_thb, a.price_unit)}</Field>
          <Field label="ยอดรวม">
            <span data-testid="agreement-total">{totalText(a.total_amount_thb)}</span>
          </Field>
          <Field label="ยืนยันเมื่อ">{formatDateTime(a.confirmed_at)}</Field>
        </dl>
        {purchase ? (
          <dl className="space-y-2 border-t border-slate-200 pt-3 text-sm" aria-label="ปริมาณขายต่อ">
            <Field label="จองขายต่อแล้ว">{formatKg(a.resale_reserved_kg)}</Field>
            <Field label="ขายต่อได้อีก">
              <span data-testid="resale-remaining">{formatKg(remainingKg(a.qty_kg, a.resale_reserved_kg))}</span>
            </Field>
          </dl>
        ) : (
          <p className="text-xs text-slate-600">ข้อตกลงบริการไม่เปลี่ยนเจ้าของวัสดุและไม่เปลี่ยนปริมาณคงเหลือ</p>
        )}
        {a.source_agreement_id ? (
          <p className="text-sm">
            ต่อจาก <Link className="underline" href={`/agreements/${encodeURIComponent(a.source_agreement_id)}`}>ข้อตกลงต้นทาง</Link>
          </p>
        ) : null}
        <Link href={`/offers/${encodeURIComponent(a.offer_id)}`} className="inline-flex min-h-11 items-center text-sm underline">
          ดูข้อเสนอที่ตอบรับ
        </Link>
      </section>
    </div>
  );
}
