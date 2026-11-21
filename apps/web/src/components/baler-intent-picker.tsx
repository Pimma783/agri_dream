'use client';
import { useState } from 'react';
import { BUTTON_CLASS } from './cards';
import { RadioChoice } from './form-fields';

export type BalerIntent = 'RESALE' | 'SERVICE';
export const BALER_INTENT_PATH: Record<BalerIntent, string> = {
  RESALE: '/demands/new?intent=resale',
  SERVICE: '/services/new',
};

/** A baler must choose explicitly. Nothing is pre-selected and the button stays off until a choice is made. */
export function BalerIntentPicker({ navigate }: { navigate?: (path: string) => void }) {
  const [intent, setIntent] = useState<BalerIntent | ''>('');
  return (
    <form
      aria-label="เลือกประเภทประกาศ"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (intent === '') return;
        (navigate ?? ((p: string) => window.location.assign(p)))(BALER_INTENT_PATH[intent]);
      }}
    >
      <RadioChoice
        label="คุณต้องการทำอะไร"
        name="baler_intent"
        value={intent}
        onChange={setIntent}
        options={[
          { value: 'RESALE', label: 'รับซื้อเพื่อขายต่อ', hint: 'ซื้อฟางจากเกษตรกรแล้วขายต่อให้โรงงาน' },
          { value: 'SERVICE', label: 'รับจ้างอัด', hint: 'อัดฟางให้เจ้าของ ไม่เปลี่ยนเจ้าของฟาง' },
        ]}
      />
      <button type="submit" className={`${BUTTON_CLASS} w-full`} disabled={intent === ''}>
        ต่อไป
      </button>
    </form>
  );
}
