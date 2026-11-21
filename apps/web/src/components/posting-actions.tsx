'use client';
import { useState } from 'react';
import type { PostingAction, PostingStatus } from '@agrimatch/contracts';
import { ApiRequestError, SessionExpiredError } from '@/lib/api-core';
import { ACTION_DONE_LABEL, ACTION_LABEL, POSTING_STATUS_ACTIONS } from '@/lib/postings';
import { changePostingStatus, defaultPostingsApi, type PostingResource, type PostingsApi } from '@/lib/postings-client';
import { BUTTON_CLASS } from './cards';
import { Notice } from './feedback';

const SECONDARY =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-400 bg-white px-4 text-base font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50';
const DANGER =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-red-700 px-4 text-base font-medium text-white hover:bg-red-800 disabled:opacity-50';

/** pause / open / close / cancel with the current version. Closing and cancelling ask for a second tap. */
export function PostingActions(props: {
  resource: PostingResource;
  id: string;
  status: PostingStatus;
  version: number;
  api?: PostingsApi;
  onDone?: () => void;
  onExpired?: () => void;
}) {
  const api = props.api ?? defaultPostingsApi;
  const [confirming, setConfirming] = useState<PostingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PostingAction | null>(null);
  const actions = POSTING_STATUS_ACTIONS[props.status];

  async function run(action: PostingAction) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await changePostingStatus(api, props.resource, props.id, action, props.version);
      setDone(action);
      setConfirming(null);
      (props.onDone ?? (() => window.location.reload()))();
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

  if (actions.length === 0) return <p className="text-sm text-slate-600">ประกาศนี้สิ้นสุดแล้ว ไม่สามารถเปลี่ยนสถานะได้</p>;
  return (
    <section aria-label="จัดการประกาศ" className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {done ? <Notice tone="success">{ACTION_DONE_LABEL[done]}</Notice> : null}
      {confirming ? (
        <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-sm text-red-900">ยืนยัน{ACTION_LABEL[confirming]}? ทำแล้วย้อนกลับไม่ได้</p>
          <div className="flex gap-2">
            <button type="button" className={`${SECONDARY} flex-1`} onClick={() => setConfirming(null)} disabled={busy}>
              ไม่ทำ
            </button>
            <button type="button" className={`${DANGER} flex-1`} onClick={() => void run(confirming)} disabled={busy}>
              ยืนยัน
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {actions.map((a) => {
            const destructive = a === 'close' || a === 'cancel';
            return (
              <button
                key={a}
                type="button"
                className={a === 'open' ? BUTTON_CLASS : SECONDARY}
                disabled={busy}
                onClick={() => (destructive ? setConfirming(a) : void run(a))}
              >
                {ACTION_LABEL[a]}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
