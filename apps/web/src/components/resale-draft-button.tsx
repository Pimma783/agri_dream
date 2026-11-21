'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ApiRequestError, SessionExpiredError } from '@/lib/api-core';
import { createResaleDraft, defaultOffersApi, resaleDraftHref, type OffersApi } from '@/lib/offers';
import { BUTTON_CLASS } from './cards';
import { Notice } from './feedback';

/** BALER on a PURCHASE_CONFIRMED agreement. Creates a draft only; nothing is published. */
export function ResaleDraftButton(props: { agreementId: string; disabled?: boolean; api?: OffersApi; onExpired?: () => void }) {
  const api = props.api ?? defaultOffersApi;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const view = await createResaleDraft(api, props.agreementId);
      setDraftId(view.draft.id);
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        (props.onExpired ?? (() => window.location.assign('/login?expired=1')))();
        return;
      }
      setError(e instanceof ApiRequestError ? e.messageTh : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setBusy(false);
    }
  }
  if (draftId) {
    return (
      <div className="space-y-2">
        <Notice tone="success">สร้างร่างประกาศขายต่อแล้ว ยังไม่ได้เผยแพร่</Notice>
        <Link href={resaleDraftHref(draftId)} className={`${BUTTON_CLASS} w-full`}>เปิดร่างประกาศ</Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button type="button" className={`${BUTTON_CLASS} w-full`} disabled={busy || props.disabled} onClick={() => void run()}>
        สร้างประกาศขายต่อ
      </button>
      {props.disabled ? <p className="text-xs text-slate-600">ไม่มีปริมาณเหลือให้ขายต่อ</p> : null}
    </div>
  );
}
