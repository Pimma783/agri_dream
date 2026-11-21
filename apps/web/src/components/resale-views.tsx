import Link from 'next/link';
import type { AgreementView, DraftView, ListingView } from '@agrimatch/contracts';
import { formatDate, formatKg } from '@/lib/format';
import { FORM_LABEL, MATERIAL_LABEL } from '@/lib/postings';
import { agreementRef, DRAFT_STATUS_LABEL, priceLabel } from '@/lib/resale';
import { BUTTON_CLASS, Card, CardList, Field } from './cards';
import { StatusBadge } from './feedback';
import { PendingMaterial } from './pending-material';

const draftBadge = (status: DraftView['draft']['status']) => (
  <span className="inline-flex rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-800">{DRAFT_STATUS_LABEL[status]}</span>
);

function materialOf(type: unknown): string {
  return typeof type === 'string' && type in MATERIAL_LABEL ? MATERIAL_LABEL[type as keyof typeof MATERIAL_LABEL] : '-';
}

/** The source Agreement as a reference only: short id and confirmation date. No party or farmer data. */
export function SourceRef({ id, agreements }: { id: string | null | undefined; agreements?: readonly AgreementView[] }) {
  const a = agreements?.find((x) => x.id === id);
  return (
    <Field label="ข้อตกลงต้นทาง">
      <span data-testid="source-ref">{agreementRef(id)}{a ? ` · ${formatDate(a.confirmed_at)}` : ''}</span>
    </Field>
  );
}

export function ResaleDraftCards({ items, agreements }: { items: DraftView[]; agreements?: readonly AgreementView[] }) {
  return (
    <CardList label="ร่างประกาศขายต่อ">
      {items.map((v) => {
        const d = v.draft.data;
        return (
          <Card key={v.draft.id} title={`${materialOf(d.material_type)} (ร่าง)`} badge={draftBadge(v.draft.status)}>
            <dl className="space-y-1">
              <Field label="ปริมาณที่จองไว้">{typeof d.qty_kg === 'string' ? formatKg(d.qty_kg) : '-'}</Field>
              <Field label="ปริมาณที่ประกาศ">ยังไม่ได้เผยแพร่</Field>
              <Field label="ราคา">{priceLabel(d)}</Field>
              <SourceRef id={v.draft.source_agreement_id} {...(agreements ? { agreements } : {})} />
            </dl>
            <PendingMaterial data={d} />
            {v.complete ? null : <p className="text-xs text-amber-900">ข้อมูลยังไม่ครบ ต้องแก้ก่อนเผยแพร่</p>}
            <Link href={`/resale/${encodeURIComponent(v.draft.id)}`} className={`${BUTTON_CLASS} w-full`}>
              แก้ไขร่าง
            </Link>
          </Card>
        );
      })}
    </CardList>
  );
}

export function ResaleListingCards({ items, agreements }: { items: ListingView[]; agreements?: readonly AgreementView[] }) {
  return (
    <CardList label="ประกาศขายต่อที่เผยแพร่">
      {items.map((l) => (
        <Card key={l.id} title={materialOf(l.material_type)} badge={<StatusBadge status={l.status} />}>
          <dl className="space-y-1">
            <Field label="ปริมาณที่ประกาศ">{formatKg(l.total_qty_kg)}</Field>
            <Field label="มีผู้ตกลงซื้อแล้ว">{formatKg(l.committed_qty_kg)}</Field>
            <Field label="คงเหลือ">{formatKg(l.remaining_qty_kg)}</Field>
            {l.material_form ? <Field label="รูปแบบ">{FORM_LABEL[l.material_form]}</Field> : null}
            <Field label="ราคา">{priceLabel({ price_mode: l.price_mode, unit_price_thb: l.unit_price_thb, price_unit: l.price_unit })}</Field>
            <SourceRef id={l.source_agreement_id} {...(agreements ? { agreements } : {})} />
          </dl>
          <PendingMaterial data={l} />
        </Card>
      ))}
    </CardList>
  );
}
