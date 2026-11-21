import { useMemo } from 'react';
import type { LoginFormProps } from './login-form';
import { JudgeLoginPanel, type JudgeCredentials } from './judge-login-panel';
import { Notice } from './feedback';
import { LOGIN_EXPIRED_MESSAGE } from '@/lib/login';
import { FACTORY_OA_ID, FARMER_OA_ID, lineAddFriendUrl, qrGeometry, type LoginRole } from '@/lib/line-oa';

const LINK_BUTTON =
  'flex min-h-12 w-full items-center justify-center rounded-lg bg-emerald-700 px-4 text-base font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';
const CHOICE =
  'flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-emerald-700 bg-white px-4 py-5 text-xl font-semibold text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';

function QrCode({ url, label }: { url: string; label: string }) {
  const { size, path } = useMemo(() => qrGeometry(url), [url]);
  return (
    <svg
      role="img" aria-label={label} data-testid="line-qr" viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      shapeRendering="crispEdges" className="mx-auto h-48 w-48 rounded-lg border border-slate-200 bg-white"
    >
      <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function LinePanel({ oaId, label }: { oaId: string; label: string }) {
  const url = lineAddFriendUrl(oaId);
  return (
    <div className="space-y-3">
      <QrCode url={url} label={label} />
      <a href={url} className={LINK_BUTTON}>
        เพิ่มเพื่อนใน LINE
        <span className="ml-2 text-sm font-normal">/ Add friend on LINE</span>
      </a>
    </div>
  );
}

function Back({ expired }: { expired: boolean }) {
  return (
    <a href={expired ? '/login?expired=1' : '/login'} className="inline-flex min-h-11 items-center text-base font-medium text-emerald-800 underline">
      ← กลับ / Back
    </a>
  );
}

export interface LoginGateProps extends Pick<LoginFormProps, 'fetchImpl' | 'onSuccess'> {
  role: LoginRole | null;
  expired?: boolean;
  /** Judge factory account, read on the server. Only shown in the factory view. */
  judge?: JudgeCredentials | null;
}

export function LoginGate({ role, expired = false, fetchImpl, onSuccess, judge = null }: LoginGateProps) {
  if (role === null) {
    return (
      <div className="space-y-4">
        <p className="text-base font-medium text-slate-800">
          คุณคือใคร
          <span className="block text-sm font-normal text-slate-600">Who are you?</span>
        </p>
        {expired ? <Notice tone="warning">{LOGIN_EXPIRED_MESSAGE}</Notice> : null}
        <a href={`/login?role=farmer${expired ? '&expired=1' : ''}`} className={CHOICE}>
          <span aria-hidden="true" className="text-5xl">🌾</span>
          <span>เกษตรกร</span>
          <span className="text-base font-normal">Farmer</span>
        </a>
        <a href={`/login?role=factory${expired ? '&expired=1' : ''}`} className={CHOICE}>
          <span aria-hidden="true" className="text-5xl">🏭</span>
          <span>โรงงาน / ผู้รับซื้อ</span>
          <span className="text-base font-normal">Factory / Buyer</span>
        </a>
      </div>
    );
  }
  if (role === 'farmer') {
    return (
      <div className="space-y-4">
        <Back expired={expired} />
        <h2 className="text-lg font-semibold">เกษตรกร <span className="text-base font-normal text-slate-600">/ Farmer</span></h2>
        <LinePanel oaId={FARMER_OA_ID} label="QR LINE เกษตรกร" />
        <ol className="list-decimal space-y-1 pl-5 text-base text-slate-700">
          <li>สแกน QR หรือกดปุ่ม <span className="text-sm text-slate-500">/ Scan the QR or tap</span></li>
          <li>เพิ่มเพื่อนใน LINE <span className="text-sm text-slate-500">/ Add friend</span></li>
          <li>กดเมนูเพื่อลงขายฟาง <span className="text-sm text-slate-500">/ Use the menu to list straw</span></li>
        </ol>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Back expired={expired} />
      <h2 className="text-lg font-semibold">โรงงาน / ผู้รับซื้อ <span className="text-base font-normal text-slate-600">/ Factory / Buyer</span></h2>
      <JudgeLoginPanel judge={judge} expired={expired} {...(fetchImpl ? { fetchImpl } : {})} {...(onSuccess ? { onSuccess } : {})} />
      <div className="space-y-3 border-t border-slate-200 pt-4">
        <p className="text-center text-base font-medium text-slate-700">หรือใช้ผ่าน LINE <span className="text-sm font-normal">/ Or use LINE</span></p>
        <LinePanel oaId={FACTORY_OA_ID} label="QR LINE โรงงาน" />
      </div>
    </div>
  );
}
