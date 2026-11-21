import { pendingOf, pendingText } from '@/lib/resale';

/** «รอรับ/รออัด» with the expected-ready date. Renders nothing when the material is not pending. */
export function PendingMaterial({ data }: { data: { pending_material?: unknown; expected_ready_at?: unknown } }) {
  const text = pendingText(pendingOf(data));
  if (text === null) return null;
  return (
    <p data-testid="pending-material" className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">
      {text}
    </p>
  );
}
