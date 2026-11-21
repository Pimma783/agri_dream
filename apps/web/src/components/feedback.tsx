import type { ReactNode } from 'react';
import type {
  AgreementStatus,
  ImageAssessmentStatus,
  OfferStatus,
  PostingStatus,
} from '@agrimatch/contracts';
import { ApiRequestError } from '@/lib/api-core';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONE_CLASS: Record<Tone, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-900',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-red-300 bg-red-50 text-red-900',
};

export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className={`rounded-lg border p-3 text-sm ${TONE_CLASS[tone]}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : ''}>{children}</div> : null}
    </div>
  );
}

/** Shows the Thai message from an API error, or a generic fallback. */
export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof ApiRequestError ? error.messageTh : 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  return <Notice tone="error">{message}</Notice>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">{children}</div>;
}

interface BadgeSpec {
  label: string;
  tone: 'green' | 'amber' | 'red' | 'slate' | 'blue';
}

const BADGE_CLASS: Record<BadgeSpec['tone'], string> = {
  green: 'bg-emerald-100 text-emerald-900',
  amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-900',
  slate: 'bg-slate-200 text-slate-800',
  blue: 'bg-sky-100 text-sky-900',
};

// Agreement labels never claim payment, delivery or quality checks (Requirement 19).
export const STATUS_BADGES = {
  PENDING: { label: 'รอตอบรับ', tone: 'amber' },
  ACCEPTED: { label: 'ตอบรับแล้ว', tone: 'green' },
  REJECTED: { label: 'ปฏิเสธ', tone: 'red' },
  WITHDRAWN: { label: 'ถอนข้อเสนอ', tone: 'slate' },
  EXPIRED: { label: 'หมดอายุ', tone: 'slate' },
  PUBLISHED: { label: 'เปิดอยู่', tone: 'green' },
  PAUSED: { label: 'พักไว้', tone: 'amber' },
  CLOSED: { label: 'ปิดแล้ว', tone: 'slate' },
  CANCELLED: { label: 'ยกเลิก', tone: 'red' },
  PURCHASE_CONFIRMED: { label: 'ยืนยันการซื้อ', tone: 'green' },
  SERVICE_CONFIRMED: { label: 'ยืนยันบริการ', tone: 'green' },
  NEEDS_REVIEW: { label: 'ต้องตรวจสอบ', tone: 'amber' },
  OK: { label: 'ประเมินได้', tone: 'blue' },
  UNASSESSABLE: { label: 'ประเมินไม่ได้', tone: 'slate' },
  UNAVAILABLE: { label: 'ยังไม่พร้อมประเมิน', tone: 'slate' },
  FAILED: { label: 'ประเมินไม่สำเร็จ', tone: 'red' },
} satisfies Record<OfferStatus | PostingStatus | AgreementStatus | ImageAssessmentStatus, BadgeSpec>;

export type BadgeStatus = keyof typeof STATUS_BADGES;

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const spec: BadgeSpec = STATUS_BADGES[status];
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${BADGE_CLASS[spec.tone]}`}
    >
      {spec.label}
    </span>
  );
}
