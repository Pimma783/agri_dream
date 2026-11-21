'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { BUTTON_CLASS } from './cards';
import { Notice } from './feedback';
import { LOGIN_EXPIRED_MESSAGE, loginErrorMessage } from '@/lib/login';

export interface LoginFormProps {
  /** True when the page was opened as /login?expired=1. */
  expired?: boolean;
  fetchImpl?: typeof fetch;
  /** Called after a successful login. Default: full page load of "/", so the new cookie is used. */
  onSuccess?: () => void;
  /** Pass a new object to replace both fields (used by the judge "fill in" button). */
  fill?: { email: string; password: string } | null;
}

const INPUT_CLASS =
  'block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700';

export function LoginForm({ expired = false, fetchImpl, onSuccess, fill }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!fill) return;
    setEmail(fill.email);
    setPassword(fill.password);
  }, [fill]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const doFetch = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
      const res = await doFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.ok) {
        (onSuccess ?? (() => window.location.assign('/')))();
        return;
      }
      setError(loginErrorMessage(res.status));
    } catch {
      setError(loginErrorMessage(0));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="เข้าสู่ระบบ" noValidate>
      {expired ? <Notice tone="warning">{LOGIN_EXPIRED_MESSAGE}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium">อีเมล</label>
        <input
          id="email" name="email" type="email" inputMode="email" autoComplete="username" required
          value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium">รหัสผ่าน</label>
        <input
          id="password" name="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT_CLASS}
        />
      </div>
      <button type="submit" disabled={busy || email.trim() === '' || password === ''} className={`${BUTTON_CLASS} w-full`}>
        {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
      </button>
    </form>
  );
}
