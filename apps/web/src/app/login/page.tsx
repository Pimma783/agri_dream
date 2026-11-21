import { LoginForm } from '@/components/login-form';
import { serverApi } from '@/lib/api-server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Outside the (app) layout: no navigation and no session requirement.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string | string[] }> }) {
  const { expired } = await searchParams;
  const me = await (await serverApi()).getMe().catch(() => null);
  // An expired banner means the session is gone, so never bounce back to "/" in that case.
  if (me && expired !== '1') redirect('/');
  return (
    <main className="mx-auto w-full max-w-sm min-w-0 px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-emerald-800">Agrimatch</h1>
      <p className="mb-6 text-sm text-slate-600">เข้าสู่ระบบเพื่อจัดการประกาศและข้อเสนอ</p>
      <LoginForm expired={expired === '1'} />
    </main>
  );
}
