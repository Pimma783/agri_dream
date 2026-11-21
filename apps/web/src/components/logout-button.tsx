'use client';
import { useState } from 'react';
import { z } from 'zod';
import { browserApi } from '@/lib/api';
import { SessionExpiredError } from '@/lib/api-core';
import { BUTTON_CLASS } from './cards';
import { Notice } from './feedback';

export function LogoutButton({ logout, navigate }: { logout?: () => Promise<unknown>; navigate?: (path: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function run() {
    setBusy(true);
    setError(false);
    try {
      await (logout ?? (() => browserApi.post('/auth/logout', z.unknown())))();
      (navigate ?? ((p: string) => window.location.assign(p)))('/login');
    } catch (e) {
      // An already-expired session is logged out as far as the user is concerned.
      if (e instanceof SessionExpiredError) {
        (navigate ?? ((p: string) => window.location.assign(p)))('/login');
        return;
      }
      setError(true);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      {error ? <Notice tone="error">ออกจากระบบไม่สำเร็จ กรุณาลองใหม่</Notice> : null}
      <button
        type="button" onClick={run} disabled={busy}
        className={`${BUTTON_CLASS.replace('bg-emerald-700', 'bg-slate-700').replace('hover:bg-emerald-800', 'hover:bg-slate-800')} w-full`}
      >
        {busy ? 'กำลังออก…' : 'ออกจากระบบ'}
      </button>
    </div>
  );
}
