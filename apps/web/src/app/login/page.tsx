import { LoginGate } from '@/components/login-gate';
import { parseRole } from '@/lib/line-oa';
import { serverApi } from '@/lib/api-server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Both variables must be set, otherwise nothing is shown. Read per request (force-dynamic), never at build. */
function readJudge(): { email: string; password: string } | null {
  const email = process.env.JUDGE_DEMO_EMAIL?.trim();
  const password = process.env.JUDGE_DEMO_PASSWORD;
  return email && password ? { email, password } : null;
}

// Outside the (app) layout: no navigation and no session requirement.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string | string[]; role?: string | string[] }> }) {
  const { expired, role } = await searchParams;
  const me = await (await serverApi()).getMe().catch(() => null);
  // An expired banner means the session is gone, so never bounce back to "/" in that case.
  if (me && expired !== '1') redirect('/');
  return (
    <main className="mx-auto w-full max-w-sm min-w-0 px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-emerald-800">Agrimatch</h1>
      <p className="mb-6 text-sm text-slate-600">
        เลือกวิธีเข้าใช้งาน
        <span className="block">Choose how to sign in</span>
      </p>
      <LoginGate role={parseRole(role)} expired={expired === '1'} judge={parseRole(role) === 'factory' ? readJudge() : null} />
    </main>
  );
}
