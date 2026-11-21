'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { MatchView, OfferView, TransportBy } from '@agrimatch/contracts';
import { ApiRequestError, SessionExpiredError } from '@/lib/api-core';
import {
  BALING_PRICE_UNITS,
  buildTerms,
  createOffer,
  defaultOffersApi,
  editOffer,
  emptyTermsForm,
  formErrorsFromPaths,
  formFromOffer,
  INSUFFICIENT_QUANTITY_TH,
  newKey,
  OFFER_PRICE_UNITS,
  PENDING_ACK_TH,
  TRANSPORT_BY_LABEL,
  type OfferFormErrors,
  type OffersApi,
  type OfferTermsForm,
} from '@/lib/offers';
import { counterpartyName, NO_CONTACT_NOTICE } from '@/lib/matches';
import { pendingOf, pendingText } from '@/lib/resale';
import { BUTTON_CLASS } from './cards';
import { Notice } from './feedback';
import { AmountInput, CheckBox, KG_TON_UNITS, RadioChoice, TextInput } from './form-fields';

const SECONDARY =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-400 bg-white px-4 text-base font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50';
const TRANSPORT_CHOICES = (Object.keys(TRANSPORT_BY_LABEL) as TransportBy[]).map((v) => ({ value: v, label: TRANSPORT_BY_LABEL[v] }));

export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return e.code === 'INSUFFICIENT_QUANTITY' ? INSUFFICIENT_QUANTITY_TH : e.messageTh;
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

export function TermsFields(props: {
  kind: 'PURCHASE' | 'BALING_SERVICE';
  value: OfferTermsForm;
  onChange: (v: OfferTermsForm) => void;
  errors: OfferFormErrors;
}) {
  const { kind, value, onChange, errors } = props;
  const set = <K extends keyof OfferTermsForm>(k: K, v: OfferTermsForm[K]) => onChange({ ...value, [k]: v });
  const priceUnits = kind === 'PURCHASE' ? OFFER_PRICE_UNITS : BALING_PRICE_UNITS;
  return (
    <div className="space-y-4">
      <AmountInput
        label="ปริมาณ"
        amount={value.qty}
        unit={value.qtyUnit}
        units={KG_TON_UNITS}
        onAmount={(v) => set('qty', v)}
        onUnit={(u) => set('qtyUnit', u)}
        error={errors.qty}
      />
      <AmountInput
        label="ราคาที่เสนอ (เว้นว่างได้)"
        amount={value.price}
        unit={value.priceUnit}
        units={priceUnits}
        onAmount={(v) => set('price', v)}
        onUnit={(u) => set('priceUnit', u)}
        error={errors.price}
        hint="ถ้าไม่ใส่ราคา ระบบจะไม่คำนวณยอดรวม"
      />
      <RadioChoice label="ใครรับผิดชอบการขนส่ง" name="transportBy" value={value.transportBy} options={TRANSPORT_CHOICES} onChange={(v) => set('transportBy', v)} />
      <TextInput
        label="ค่าขนส่ง บาท (เว้นว่างถ้ายังไม่ทราบ)"
        value={value.transportCost}
        onChange={(v) => set('transportCost', v)}
        inputMode="decimal"
        error={errors.transportCost}
        hint="แสดงแยกจากยอดรวมเสมอ"
      />
      <TextInput label="วันที่พร้อมส่ง (ถ้ามี)" type="date" value={value.readyDate} onChange={(v) => set('readyDate', v)} error={errors.readyDate} />
    </div>
  );
}

/** Reuses one Idempotency-Key for a retry of the same payload; a changed payload gets a new key. */
function useAttemptKey() {
  const ref = useRef<{ key: string; fingerprint: string } | null>(null);
  return {
    keyFor(fingerprint: string): string {
      if (!ref.current || ref.current.fingerprint !== fingerprint) ref.current = { key: newKey(), fingerprint };
      return ref.current.key;
    },
    reset() {
      ref.current = null;
    },
  };
}

export function CreateOfferForm(props: { match: MatchView; api?: OffersApi; onExpired?: () => void }) {
  const api = props.api ?? defaultOffersApi;
  const { match } = props;
  const kind = match.route === 3 ? 'BALING_SERVICE' : 'PURCHASE';
  const [form, setForm] = useState<OfferTermsForm>(() => emptyTermsForm(kind));
  const [errors, setErrors] = useState<OfferFormErrors>({});
  const [needAck, setNeedAck] = useState(match.counterparty.published.pending_material === true);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<OfferView | null>(null);
  const attempt = useAttemptKey();
  const expectedText = pendingText(pendingOf(match.counterparty.published));

  async function submit() {
    if (busy) return;
    setError(null);
    const built = buildTerms(form);
    const errs: OfferFormErrors = { ...built.errors };
    if (needAck && !ack) errs.ack = 'ต้องติ๊กรับทราบก่อนส่งข้อเสนอ';
    setErrors(errs);
    if (!built.terms || Object.keys(errs).length > 0) return;
    const body = { kind, matchId: match.id, ...built.terms, ...(needAck ? { ackPendingMaterial: true } : {}) } as const;
    setBusy(true);
    try {
      const out = await createOffer(api, body, attempt.keyFor(JSON.stringify(body)));
      attempt.reset();
      setCreated(out.offer);
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        (props.onExpired ?? (() => window.location.assign('/login?expired=1')))();
        return;
      }
      if (e instanceof ApiRequestError && e.code === 'VALIDATION') {
        const fromApi = formErrorsFromPaths(e.fieldPaths);
        if (fromApi.ack) setNeedAck(true);
        setErrors(fromApi);
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-3">
        <Notice tone="success" title="ส่งข้อเสนอแล้ว">ข้อเสนอรอการตอบรับจากอีกฝ่าย ยังไม่ใช่ข้อตกลง</Notice>
        <Link href={`/offers/${encodeURIComponent(created.id)}`} className={`${BUTTON_CLASS} w-full`}>ดูข้อเสนอ</Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section aria-label="คู่ค้า" className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <p className="font-semibold">{counterpartyName(match.counterparty)}</p>
        <p className="text-slate-600">{match.counterparty.province ?? 'ไม่ระบุจังหวัด'}</p>
        <p className="mt-1 text-xs text-slate-600">{NO_CONTACT_NOTICE}</p>
      </section>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TermsFields kind={kind} value={form} onChange={setForm} errors={errors} />
      {needAck ? (
        <div className="space-y-1">
          <Notice tone="warning" title="วัสดุยังไม่พร้อม">
            <p>ผู้ขายแจ้งว่าวัสดุอยู่ระหว่างรอรับหรือรออัด</p>
            {expectedText ? <p data-testid="expected-ready">{expectedText}</p> : null}
          </Notice>
          <CheckBox label={PENDING_ACK_TH} checked={ack} onChange={setAck} />
          {errors.ack ? <p role="alert" className="text-sm text-red-800">{errors.ack}</p> : null}
        </div>
      ) : null}
      <p className="text-xs text-slate-600">ข้อเสนอจะหมดอายุภายใน 72 ชั่วโมงถ้าอีกฝ่ายไม่ตอบ</p>
      <button type="submit" className={`${BUTTON_CLASS} w-full`} disabled={busy}>
        {busy ? 'กำลังส่ง...' : 'ส่งข้อเสนอ'}
      </button>
    </form>
  );
}

/** Edit = withdraw the pending offer and create a new one (one API call). */
export function EditOfferForm(props: { offer: OfferView; api?: OffersApi; onDone: (o: OfferView) => void; onCancel: () => void; onExpired?: () => void }) {
  const api = props.api ?? defaultOffersApi;
  const { offer } = props;
  const [form, setForm] = useState<OfferTermsForm>(() => formFromOffer(offer));
  const [errors, setErrors] = useState<OfferFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useAttemptKey();

  async function submit() {
    if (busy) return;
    setError(null);
    const built = buildTerms(form);
    setErrors(built.errors);
    if (!built.terms) return;
    const changes = { ...built.terms };
    setBusy(true);
    try {
      const out = await editOffer(api, offer, changes, attempt.keyFor(JSON.stringify(changes)));
      attempt.reset();
      props.onDone(out.offer);
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        (props.onExpired ?? (() => window.location.assign('/login?expired=1')))();
        return;
      }
      if (e instanceof ApiRequestError && e.code === 'VALIDATION') setErrors(formErrorsFromPaths(e.fieldPaths));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="แก้ไขข้อเสนอ"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Notice>การแก้ไขจะถอนข้อเสนอเดิมและส่งข้อเสนอใหม่ให้อีกฝ่ายตอบรับใหม่</Notice>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TermsFields kind={offer.kind} value={form} onChange={setForm} errors={errors} />
      <div className="flex gap-2">
        <button type="button" className={`${SECONDARY} flex-1`} onClick={props.onCancel} disabled={busy}>ยกเลิก</button>
        <button type="submit" className={`${BUTTON_CLASS} flex-1`} disabled={busy}>ส่งข้อเสนอใหม่</button>
      </div>
    </form>
  );
}
