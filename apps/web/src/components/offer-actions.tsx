'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { OfferView } from '@agrimatch/contracts';
import { ApiRequestError, SessionExpiredError } from '@/lib/api-core';
import {
  acceptOffer,
  defaultOffersApi,
  newKey,
  offerActions,
  PENDING_ACK_TH,
  rejectOffer,
  withdrawOffer,
  type OffersApi,
} from '@/lib/offers';
import { BUTTON_CLASS } from './cards';
import { Notice } from './feedback';
import { CheckBox } from './form-fields';
import { EditOfferForm, errorMessage } from './offer-form';

const SECONDARY =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-400 bg-white px-4 text-base font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50';
const DANGER =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-red-700 px-4 text-base font-medium text-white hover:bg-red-800 disabled:opacity-50';

type Done = { kind: 'accepted'; agreementId: string } | { kind: 'rejected' } | { kind: 'withdrawn' } | { kind: 'edited'; offerId: string };

/** Accept or reject for the receiver; withdraw or edit for the sender. Only while the offer is PENDING. */
export function OfferActionsPanel(props: { offer: OfferView; api?: OffersApi; onDone?: () => void; onExpired?: () => void }) {
  const api = props.api ?? defaultOffersApi;
  const { offer } = props;
  const actions = offerActions(offer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'reject' | 'withdraw' | null>(null);
  const [needAck, setNeedAck] = useState(false);
  const [ack, setAck] = useState(false);
  const [ackError, setAckError] = useState(false);

  const expired = () => (props.onExpired ?? (() => window.location.assign('/login?expired=1')))();

  async function run(fn: () => Promise<Done>, isAccept = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await fn());
      setConfirm(null);
      props.onDone?.();
    } catch (e) {
      if (e instanceof SessionExpiredError) return expired();
      // A VALIDATION failure on accept can only be the pending-material acknowledgement.
      if (e instanceof ApiRequestError && e.code === 'VALIDATION' && isAccept) setNeedAck(true);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onAccept() {
    if (needAck && !ack) {
      setAckError(true);
      return;
    }
    setAckError(false);
    void run(async () => {
      const out = await acceptOffer(api, offer, needAck && ack, newKey());
      return { kind: 'accepted', agreementId: out.agreement.id };
    }, true);
  }

  if (done) {
    return (
      <div className="space-y-3">
        {done.kind === 'accepted' ? (
          <>
            <Notice tone="success" title="ตอบรับแล้ว">ข้อตกลงถูกสร้างแล้ว ระบบบันทึกเฉพาะการยืนยัน ไม่ใช่การชำระเงินหรือส่งมอบ</Notice>
            <Link href={`/agreements/${encodeURIComponent(done.agreementId)}`} className={`${BUTTON_CLASS} w-full`}>ดูข้อตกลง</Link>
          </>
        ) : null}
        {done.kind === 'rejected' ? <Notice tone="success">ปฏิเสธข้อเสนอแล้ว</Notice> : null}
        {done.kind === 'withdrawn' ? <Notice tone="success">ถอนข้อเสนอแล้ว</Notice> : null}
        {done.kind === 'edited' ? (
          <>
            <Notice tone="success">ส่งข้อเสนอใหม่แล้ว ข้อเสนอเดิมถูกถอน</Notice>
            <Link href={`/offers/${encodeURIComponent(done.offerId)}`} className={`${BUTTON_CLASS} w-full`}>ดูข้อเสนอใหม่</Link>
          </>
        ) : null}
      </div>
    );
  }
  if (!actions.accept && !actions.withdraw) {
    return <p className="text-sm text-slate-600">ข้อเสนอนี้ไม่รอตอบรับแล้ว จึงไม่มีปุ่มดำเนินการ</p>;
  }
  if (editing) {
    return (
      <EditOfferForm
        offer={offer}
        api={api}
        onCancel={() => setEditing(false)}
        onDone={(o) => setDone({ kind: 'edited', offerId: o.id })}
        {...(props.onExpired ? { onExpired: props.onExpired } : {})}
      />
    );
  }
  return (
    <section aria-label="จัดการข้อเสนอ" className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {needAck ? (
        <div className="space-y-1">
          <Notice tone="warning" title="วัสดุยังไม่พร้อม">ต้องรับทราบก่อนตอบรับ</Notice>
          <CheckBox label={PENDING_ACK_TH} checked={ack} onChange={setAck} />
          {ackError ? <p role="alert" className="text-sm text-red-800">ต้องติ๊กรับทราบก่อนตอบรับ</p> : null}
        </div>
      ) : null}
      {confirm ? (
        <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-sm text-red-900">{confirm === 'reject' ? 'ยืนยันปฏิเสธข้อเสนอนี้?' : 'ยืนยันถอนข้อเสนอนี้?'}</p>
          <div className="flex gap-2">
            <button type="button" className={`${SECONDARY} flex-1`} onClick={() => setConfirm(null)} disabled={busy}>ไม่ทำ</button>
            <button
              type="button"
              className={`${DANGER} flex-1`}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (confirm === 'reject') await rejectOffer(api, offer, newKey());
                  else await withdrawOffer(api, offer, newKey());
                  return { kind: confirm === 'reject' ? 'rejected' : 'withdrawn' };
                })
              }
            >
              ยืนยัน
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {actions.accept ? (
            <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={onAccept}>ตอบรับข้อเสนอ</button>
          ) : null}
          {actions.reject ? (
            <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirm('reject')}>ปฏิเสธ</button>
          ) : null}
          {actions.edit ? (
            <button type="button" className={SECONDARY} disabled={busy} onClick={() => setEditing(true)}>แก้ไขข้อเสนอ</button>
          ) : null}
          {actions.withdraw ? (
            <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirm('withdraw')}>ถอนข้อเสนอ</button>
          ) : null}
        </div>
      )}
    </section>
  );
}
