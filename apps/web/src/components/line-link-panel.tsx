'use client';
import { useState } from 'react';
import { lineLinkCodeResponseSchema, type LineChannelName, type LineLinkCodeResponse } from '@agrimatch/contracts';
import { ApiRequestError, SessionExpiredError } from '@/lib/api-core';
import { browserApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { CHANNEL_LABEL_TH, linkErrorMessage } from '@/lib/line-link';
import { BUTTON_CLASS } from './cards';
import { Notice } from './feedback';

export interface LineLinkPanelProps {
  channel: LineChannelName;
  linked: boolean;
  /** Public Basic ID of the Official Account, from server config. Null when not configured. */
  basicId: string | null;
  /** Injected in tests. Default: the browser API client. */
  issueCode?: (channel: LineChannelName) => Promise<LineLinkCodeResponse>;
  navigate?: (path: string) => void;
}

const defaultIssue = (channel: LineChannelName) => browserApi.post('/line-link-codes', lineLinkCodeResponseSchema, { channel });

export function LineLinkPanel({ channel, linked, basicId, issueCode = defaultIssue, navigate }: LineLinkPanelProps) {
  const [issued, setIssued] = useState<LineLinkCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = CHANNEL_LABEL_TH[channel];

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Replaces any code on screen. The code is kept in memory only and is not stored.
      setIssued(await issueCode(channel));
    } catch (e) {
      setIssued(null);
      if (e instanceof SessionExpiredError) {
        (navigate ?? ((p: string) => window.location.assign(p)))('/login?expired=1');
        return;
      }
      setError(linkErrorMessage(e instanceof ApiRequestError ? e.status : 0));
    } finally {
      setBusy(false);
    }
  }

  const oa = issued?.basic_id ?? basicId;
  return (
    <section aria-label={label} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-base font-semibold">{label}</h2>
        <span
          data-testid="link-status"
          data-status={linked ? 'LINKED' : 'UNLINKED'}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${linked ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-800'}`}
        >
          {linked ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม'}
        </span>
      </div>
      <p className="break-words text-sm text-slate-700">
        {linked ? 'ต้องการเชื่อมบัญชี LINE อื่น ให้สร้างรหัสใหม่ได้' : 'สร้างรหัส แล้วส่งให้บัญชี LINE ของระบบ'}
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button type="button" onClick={generate} disabled={busy} className={`${BUTTON_CLASS} w-full`}>
        {busy ? 'กำลังสร้าง…' : issued ? 'สร้างรหัสใหม่' : 'สร้างรหัสผูกบัญชี'}
      </button>
      {issued ? (
        <div role="status" className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p className="text-slate-700">รหัสผูกบัญชี (ใช้ได้ครั้งเดียว)</p>
          <p data-testid="link-code" className="break-all text-center font-mono text-3xl font-bold tracking-widest text-emerald-900">
            {issued.code}
          </p>
          <p data-testid="link-expiry">หมดอายุ {formatDateTime(issued.expires_at)}</p>
          <ol className="list-decimal space-y-1 pl-5 text-slate-800">
            <li>
              เพิ่มเพื่อน {label}
              {oa ? <> <span data-testid="basic-id" className="break-all font-mono font-semibold">{oa}</span></> : null}
            </li>
            <li>พิมพ์รหัสนี้ส่งในแชท</li>
          </ol>
          <p className="text-xs text-slate-600">รหัสนี้จะแสดงครั้งนี้เท่านั้น ถ้าปิดหน้านี้ให้สร้างรหัสใหม่</p>
        </div>
      ) : null}
    </section>
  );
}
