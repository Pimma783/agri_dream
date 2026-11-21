'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { DraftView, MaterialForm, PriceMode } from '@agrimatch/contracts';
import { ApiRequestError, SessionExpiredError } from '@/lib/api-core';
import { formatDate, formatKg } from '@/lib/format';
import { FORM_LABEL, fieldLabel, MATERIAL_LABEL, NEGOTIABLE_LABEL } from '@/lib/postings';
import { newIdempotencyKey, publishDraft } from '@/lib/postings-client';
import {
  agreementRef,
  buildResalePatch,
  cancelResaleDraft,
  defaultResaleApi,
  formFromDraft,
  NO_IMAGE_QUALITY_NOTICE,
  patchResaleDraft,
  pendingOf,
  pendingText,
  priceLabel,
  SOURCE_NOTICE,
  type ResaleApi,
  type ResaleErrors,
  type ResaleFormState,
} from '@/lib/resale';
import { BUTTON_CLASS, Field } from './cards';
import { Notice } from './feedback';
import { DistrictSelect, ProvinceSelect } from './place-fields';
import { AmountInput, CheckBox, KG_TON_UNITS, RadioChoice, TextInput } from './form-fields';
import { EstimateLabel } from './labels';

const SECONDARY =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-400 bg-white px-4 text-base font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50';
const DANGER =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-red-700 px-4 text-base font-medium text-white hover:bg-red-800 disabled:opacity-50';

const FORM_CHOICES: { value: MaterialForm; label: string }[] = [
  { value: 'BALED', label: FORM_LABEL.BALED },
  { value: 'LOOSE', label: FORM_LABEL.LOOSE },
];
const PRICE_MODES: { value: PriceMode; label: string }[] = [
  { value: 'FIXED', label: 'กำหนดราคา' },
  { value: 'NEGOTIABLE', label: NEGOTIABLE_LABEL },
];
const PRICE_UNITS = [
  { value: 'ton', label: 'บาท/ตัน' },
  { value: 'kg', label: 'บาท/กก.' },
] as const;

export interface ResaleEditorProps {
  initial: DraftView;
  /** Most this draft may list in kg: the agreement quantity not reserved by other drafts or listings. */
  maxKg: string;
  /** Source agreement reference only. */
  source: { id: string; confirmedAt: string | null };
  api?: ResaleApi;
  onExpired?: () => void;
}

type Phase = 'edit' | 'preview' | 'published' | 'cancelled';

export function ResaleEditor(props: ResaleEditorProps) {
  const api = props.api ?? defaultResaleApi;
  const [view, setView] = useState<DraftView>(props.initial);
  const [form, setForm] = useState<ResaleFormState>(() => formFromDraft(props.initial.draft.data));
  const [errors, setErrors] = useState<ResaleErrors>({});
  const [phase, setPhase] = useState<Phase>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const keyRef = useRef<{ id: string; version: number; key: string } | null>(null);
  const locked = view.draft.status === 'PUBLISHED' || view.draft.status === 'CANCELLED';
  const set = <K extends keyof ResaleFormState>(k: K, v: ResaleFormState[K]) => setForm((s) => ({ ...s, [k]: v }));

  function fail(e: unknown) {
    if (e instanceof SessionExpiredError) {
      (props.onExpired ?? (() => window.location.assign('/login?expired=1')))();
      return;
    }
    setError(e);
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function review() {
    const r = buildResalePatch(form, props.maxKg);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    void run(async () => {
      setView(await patchResaleDraft(api, view, r.patch));
      setPhase('preview');
    });
  }
  function publish() {
    if (!view.complete) return;
    void run(async () => {
      // Same key for the same draft version, so a retry after a lost response cannot publish twice.
      const k = keyRef.current;
      const key = k && k.id === view.draft.id && k.version === view.draft.version ? k.key : newIdempotencyKey();
      keyRef.current = { id: view.draft.id, version: view.draft.version, key };
      await publishDraft(api, view, key);
      setPhase('published');
    });
  }
  function cancel() {
    void run(async () => {
      setView(await cancelResaleDraft(api, view));
      setConfirmCancel(false);
      setPhase('cancelled');
    });
  }

  if (phase === 'published') {
    return (
      <div className="space-y-3">
        <Notice tone="success" title="เผยแพร่ประกาศขายต่อแล้ว">ระบบจะจับคู่กับโรงงานปลายทางที่รับซื้อ ยังไม่ใช่ข้อตกลงซื้อขาย</Notice>
        <Link href="/resale" className={`${BUTTON_CLASS} w-full`}>ไปที่รายการขายต่อ</Link>
      </div>
    );
  }
  if (phase === 'cancelled') {
    return (
      <div className="space-y-3">
        <Notice tone="success" title="ยกเลิกร่างแล้ว">ปริมาณที่จองไว้ถูกคืนให้ข้อตกลงต้นทางแล้ว</Notice>
        <Link href="/resale" className={`${BUTTON_CLASS} w-full`}>ไปที่รายการขายต่อ</Link>
      </div>
    );
  }
  if (locked) {
    return (
      <div className="space-y-3">
        <Notice tone="info">ร่างนี้{view.draft.status === 'PUBLISHED' ? 'เผยแพร่แล้ว' : 'ถูกยกเลิกแล้ว'} แก้ไขไม่ได้</Notice>
        <Link href="/resale" className={`${BUTTON_CLASS} w-full`}>ไปที่รายการขายต่อ</Link>
      </div>
    );
  }

  const header = (
    <section aria-label="ที่มาของวัสดุ" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <dl className="space-y-1">
        <Field label="วัสดุ">{MATERIAL_LABEL[(view.draft.data.material_type as keyof typeof MATERIAL_LABEL) ?? 'OTHER'] ?? '-'}</Field>
        <Field label="ข้อตกลงต้นทาง">
          <span data-testid="source-ref">{agreementRef(props.source.id)}{props.source.confirmedAt ? ` · ${formatDate(props.source.confirmedAt)}` : ''}</span>
        </Field>
        <Field label="ขายต่อได้สูงสุด"><span data-testid="max-qty">{formatKg(props.maxKg)}</span></Field>
      </dl>
      <p className="text-xs text-slate-600">{SOURCE_NOTICE}</p>
      <p data-testid="no-image-quality" className="text-xs text-slate-600">{NO_IMAGE_QUALITY_NOTICE}</p>
    </section>
  );

  const errorBlock = error ? (
    <Notice tone="error">
      <p>{error instanceof ApiRequestError ? error.messageTh : 'เกิดข้อผิดพลาด กรุณาลองใหม่'}</p>
      {error instanceof ApiRequestError && error.code === 'STALE_VERSION' ? <p className="mt-1">ข้อมูลถูกแก้จากที่อื่น กรุณาโหลดหน้านี้ใหม่</p> : null}
    </Notice>
  ) : null;

  const cancelBlock = confirmCancel ? (
    <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3">
      <p className="text-sm text-red-900">ยกเลิกร่างนี้และคืนปริมาณที่จองไว้?</p>
      <div className="flex gap-2">
        <button type="button" className={`${SECONDARY} flex-1`} disabled={busy} onClick={() => setConfirmCancel(false)}>ไม่ยกเลิก</button>
        <button type="button" className={`${DANGER} flex-1`} disabled={busy} onClick={cancel}>ยืนยันยกเลิกร่าง</button>
      </div>
    </div>
  ) : (
    <button type="button" className={`${SECONDARY} w-full`} disabled={busy} onClick={() => setConfirmCancel(true)}>
      ยกเลิกร่าง
    </button>
  );

  if (phase === 'preview') {
    const d = view.draft.data;
    const pending = pendingText(pendingOf(d));
    return (
      <section aria-label="ตรวจก่อนประกาศ" className="space-y-4">
        {header}
        <h2 className="text-lg font-semibold">ตรวจประกาศขายต่อ</h2>
        {view.complete ? (
          <Notice tone="success">ข้อมูลครบแล้ว กดเผยแพร่เมื่อพร้อม</Notice>
        ) : (
          <Notice tone="warning" title="ยังเผยแพร่ไม่ได้">
            <p>ข้อมูลที่ยังขาดหรือไม่ถูกต้อง:</p>
            <ul data-testid="missing-fields" className="mt-1 list-disc pl-5">
              {[...new Set(view.missing_fields.map(fieldLabel))].map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Notice>
        )}
        <dl className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <Field label="ปริมาณขายต่อ">{typeof d.qty_kg === 'string' ? formatKg(d.qty_kg) : '-'}</Field>
          <Field label="รูปแบบก้อน">{d.material_form === 'BALED' || d.material_form === 'LOOSE' ? FORM_LABEL[d.material_form] : 'ยังไม่ระบุ'}</Field>
          <Field label="ราคาขาย">{priceLabel(d)}</Field>
          <Field label="สถานที่ของผู้อัด">{[d.district, d.province].filter((x) => typeof x === 'string' && x).join(' ') || 'ยังไม่ระบุ'}</Field>
          <Field label="สถานะวัสดุ">{pending ?? 'พร้อมส่ง'}</Field>
        </dl>
        <p className="text-xs text-slate-600">
          ข้อมูลนี้เป็นสิ่งที่คุณกรอกเอง ผลจับคู่ที่ระบบคำนวณเป็น <EstimateLabel /> ไม่ใช่ราคาที่ผู้ซื้อยืนยัน
        </p>
        {errorBlock}
        <div className="flex flex-col gap-2 min-[400px]:flex-row">
          <button type="button" className={`${SECONDARY} flex-1`} disabled={busy} onClick={() => setPhase('edit')}>กลับไปแก้ไข</button>
          <button type="button" className={`${BUTTON_CLASS} flex-1`} disabled={busy || !view.complete} onClick={publish}>
            {busy ? 'กำลังส่ง…' : 'เผยแพร่ประกาศ'}
          </button>
        </div>
        {cancelBlock}
      </section>
    );
  }

  return (
    <form
      aria-label="ร่างประกาศขายต่อ"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      {header}
      <AmountInput
        label="ปริมาณขายต่อ"
        amount={form.qty}
        unit={form.qtyUnit}
        units={KG_TON_UNITS}
        onAmount={(v) => set('qty', v)}
        onUnit={(u) => set('qtyUnit', u)}
        error={errors.quantity}
        hint={`ไม่เกิน ${formatKg(props.maxKg)}`}
      />
      <RadioChoice<MaterialForm>
        label="สภาพหลังอัด / รูปแบบก้อน"
        name="material_form"
        value={form.form}
        options={FORM_CHOICES}
        onChange={(v) => set('form', v)}
      />
      <RadioChoice<PriceMode> label="ราคาขาย" name="price_mode" value={form.priceMode} options={PRICE_MODES} onChange={(v) => set('priceMode', v)} />
      {form.priceMode === 'FIXED' ? (
        <AmountInput
          label="ราคา"
          amount={form.price}
          unit={form.priceUnit}
          units={PRICE_UNITS}
          onAmount={(v) => set('price', v)}
          onUnit={(u) => set('priceUnit', u)}
          error={errors.price}
        />
      ) : null}
      {form.priceMode === 'NEGOTIABLE' ? <p className="text-sm text-slate-700">ราคาตกลงกันภายหลัง ไม่ถือว่าเป็นราคา 0 บาท</p> : null}
      <ProvinceSelect
        label="จังหวัดของผู้อัด"
        hint="สถานที่ขายต่อของคุณ ไม่ใช่ที่ตั้งของเกษตรกร"
        value={form.province}
        onChange={(v) => setForm((s) => ({ ...s, province: v, district: '' }))}
      />
      <DistrictSelect province={form.province} value={form.district} onChange={(v) => set('district', v)} />
      <CheckBox label="วัสดุยังไม่พร้อมส่ง (รอรับ/รออัด)" checked={form.pending} onChange={(on) => set('pending', on)} />
      {form.pending ? (
        <TextInput
          label="วันที่คาดว่าจะพร้อม"
          type="date"
          hint="ต้องระบุเมื่อวัสดุยังไม่พร้อม ระบบไม่เปลี่ยนสถานะเป็นรับของหรืออัดเสร็จให้เอง"
          value={form.expectedReady}
          onChange={(v) => set('expectedReady', v)}
        />
      ) : null}
      {errorBlock}
      <button type="submit" className={`${BUTTON_CLASS} w-full`} disabled={busy}>
        {busy ? 'กำลังบันทึก…' : 'บันทึกและตรวจก่อนเผยแพร่'}
      </button>
      {cancelBlock}
    </form>
  );
}
