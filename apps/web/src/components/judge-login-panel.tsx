'use client';
import { useState } from 'react';
import { LoginForm, type LoginFormProps } from './login-form';

export interface JudgeCredentials { email: string; password: string }

const SMALL_BTN =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-700 bg-white px-3 text-sm font-semibold text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';

function CopyRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-emerald-900">{label}</p>
      <div className="flex items-center gap-2">
        <code data-testid={testId} className="min-w-0 flex-1 break-all rounded bg-white px-2 py-2 font-mono text-sm">{value}</code>
        <button type="button" onClick={copy} className={SMALL_BTN} aria-label={`คัดลอก / Copy: ${label}`}>
          {copied ? '✓ คัดลอกแล้ว / Copied' : '📋 คัดลอก / Copy'}
        </button>
      </div>
    </div>
  );
}

export function JudgeLoginPanel({ judge, expired, fetchImpl, onSuccess }: Pick<LoginFormProps, 'expired' | 'fetchImpl' | 'onSuccess'> & { judge: JudgeCredentials | null }) {
  const [fill, setFill] = useState<JudgeCredentials | null>(null);
  return (
    <>
      {judge ? (
        <div className="space-y-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4" data-testid="judge-box">
          <h3 className="text-base font-semibold text-emerald-900">
            🔑 บัญชีโรงงานสำหรับกรรมการ
            <span className="block text-sm font-normal">Factory demo account for judges</span>
          </h3>
          <CopyRow label="อีเมล / Email" value={judge.email} testId="judge-email" />
          <CopyRow label="รหัสผ่าน / Password" value={judge.password} testId="judge-password" />
          <button type="button" onClick={() => setFill({ ...judge })} className={`${SMALL_BTN} w-full bg-emerald-700 text-white`}>
            ✍️ กรอกให้อัตโนมัติ / Fill in
          </button>
        </div>
      ) : null}
      <LoginForm
        expired={expired ?? false} fill={fill}
        {...(fetchImpl ? { fetchImpl } : {})} {...(onSuccess ? { onSuccess } : {})}
      />
    </>
  );
}
