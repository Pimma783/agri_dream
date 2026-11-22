'use client';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { browserApi } from '@/lib/api';

/** Ends the session on the server, then goes to the mode chooser. A session that already expired counts as logged out. */
export function LogoutLink({ className, children }: { className?: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await browserApi.post('/auth/logout', z.unknown());
    } catch {
      // Expired or unreachable: leave anyway; the server cookie is gone or will expire.
    }
    window.location.assign('/start');
  }
  return <button type="button" onClick={run} disabled={busy} className={className}>{busy ? 'กำลังออก…' : children}</button>;
}
