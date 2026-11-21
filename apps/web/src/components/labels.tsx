import type { ReactNode } from 'react';

export const ESTIMATE_TEXT = 'ประมาณการ';
export const DEMO_DEFAULT_TEXT = 'ค่าเริ่มต้นสำหรับเดโม';
export const IMAGE_DISCLAIMER_TEXT = 'การประเมินเบื้องต้นจากภาพ ไม่ใช่ผลตรวจคุณภาพจริง';

/** Label for any number the system estimated or calculated. */
export function EstimateLabel({ className = '' }: { className?: string }) {
  return (
    <span
      data-testid="estimate-label"
      className={`inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 ${className}`}
    >
      {ESTIMATE_TEXT}
    </span>
  );
}

/** Label for match scores that use default (demo) weights. */
export function DemoWeightsLabel({ className = '' }: { className?: string }) {
  return (
    <span
      data-testid="demo-weights-label"
      className={`inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-900 ${className}`}
    >
      {DEMO_DEFAULT_TEXT}
    </span>
  );
}

/** Required wherever an image assessment result is shown (Requirement 7.6). */
export function ImageAssessmentDisclaimer({ className = '' }: { className?: string }) {
  return (
    <p data-testid="image-disclaimer" className={`text-xs text-slate-600 ${className}`}>
      {IMAGE_DISCLAIMER_TEXT}
    </p>
  );
}

/** AI or system estimate: dashed amber frame plus the estimate label, never styled like a quote. */
export function EstimateValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-testid="estimate-value" className="rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-700">{label}</span>
        <EstimateLabel />
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{children}</div>
    </div>
  );
}

/** Price actually quoted by a buyer: solid green frame and an explicit source line. */
export function QuotedValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-testid="quoted-value" className="rounded-lg border border-solid border-emerald-600 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-900">
          ราคาที่ผู้ซื้อเสนอ
        </span>
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{children}</div>
    </div>
  );
}
