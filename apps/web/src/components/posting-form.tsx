'use client';
import { useRef, useState, type ReactNode } from 'react';
import type { DraftView, FormDraftKind, MaterialForm, MaterialType, PriceMode, PublishResult, ServiceMode, TransportBy } from '@agrimatch/contracts';
import { ApiRequestError, SessionExpiredError } from '@/lib/api-core';
import { formatKg } from '@/lib/format';
import {
  buildDemandPatch,
  buildServicePatch,
  emptyDemandForm,
  emptyServiceForm,
  fieldLabel,
  FORM_LABEL,
  formatPostingPrice,
  MATERIAL_LABEL,
  MATERIAL_OPTIONS,
  materialsText,
  NEGOTIABLE_LABEL,
  OTHER_MATERIAL_NOTICE,
  QUALITY_FIELDS,
  qualityLines,
  SERVICE_MODE_LABEL,
  TRANSPORT_LABEL,
  VERIFY_LABEL,
  windowText,
  type DemandFormState,
  type FormErrors,
  type ServiceFormState,
} from '@/lib/postings';
import { defaultPostingsApi, newIdempotencyKey, publishDraft, saveDraft, type PostingsApi } from '@/lib/postings-client';
import { BUTTON_CLASS, Field } from './cards';
import { EstimateLabel } from './labels';
import { Notice } from './feedback';
import { DistrictSelect, ProvinceChecks, ProvinceSelect, RadiusSelect } from './place-fields';
import { AmountInput, CheckBox, CheckChoice, FieldGroup, KG_TON_UNITS, RadioChoice, TextInput } from './form-fields';

const SECONDARY_BUTTON =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-400 bg-white px-4 text-base font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50';

const MATERIAL_CHOICES = MATERIAL_OPTIONS.map((m) => ({ value: m, label: MATERIAL_LABEL[m] }));
const TRANSPORT_CHOICES = (['SELLER', 'BUYER', 'EITHER', 'UNKNOWN'] as const).map((v) => ({ value: v, label: TRANSPORT_LABEL[v] }));
const PRICE_MODE_CHOICES: { value: PriceMode; label: string }[] = [
  { value: 'FIXED', label: 'กำหนดราคา' },
  { value: 'NEGOTIABLE', label: NEGOTIABLE_LABEL },
];

function MaterialSection(props: {
  label: string;
  values: MaterialType[];
  acknowledged: boolean;
  error: string | undefined;
  onValues: (v: MaterialType[]) => void;
  onAcknowledged: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <CheckChoice label={props.label} name="materials" values={props.values} options={MATERIAL_CHOICES} onChange={props.onValues} error={props.error} />
      {props.values.includes('OTHER') ? (
        <div className="space-y-2">
          <Notice tone="warning" title="ต้องยืนยันก่อน">
            {OTHER_MATERIAL_NOTICE}
          </Notice>
          <CheckBox label="เข้าใจและยืนยัน" checked={props.acknowledged} onChange={props.onAcknowledged} />
        </div>
      ) : null}
    </div>
  );
}

function PriceSection<U extends string>(props: {
  mode: PriceMode | '';
  amount: string;
  unit: U;
  units: readonly { value: U; label: string }[];
  errors: FormErrors;
  modeLabel: string;
  onMode: (m: PriceMode) => void;
  onAmount: (v: string) => void;
  onUnit: (u: U) => void;
}) {
  return (
    <div className="space-y-2">
      <RadioChoice label={props.modeLabel} name="price_mode" value={props.mode} options={PRICE_MODE_CHOICES} onChange={props.onMode} error={props.errors.price_mode} />
      {props.mode === 'FIXED' ? (
        <AmountInput
          label="ราคา"
          amount={props.amount}
          unit={props.unit}
          units={props.units}
          onAmount={props.onAmount}
          onUnit={props.onUnit}
          error={props.errors.price}
        />
      ) : null}
      {props.mode === 'NEGOTIABLE' ? <p className="text-sm text-slate-700">ราคาตกลงกันภายหลัง ไม่ถือว่าเป็นราคา 0 บาท</p> : null}
    </div>
  );
}

export interface PostingFormProps {
  kind: FormDraftKind;
  api?: PostingsApi;
  /** Called after a successful publish. Default: go to the detail page. */
  onPublished?: (result: PublishResult) => void;
  /** Called on 401. Default: go to the login page. */
  onExpired?: () => void;
}

function useSubmitFlow(kind: FormDraftKind, props: PostingFormProps) {
  const api = props.api ?? defaultPostingsApi;
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [phase, setPhase] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const keyRef = useRef<{ draftId: string; version: number; key: string } | null>(null);

  function fail(e: unknown) {
    if (e instanceof SessionExpiredError) {
      (props.onExpired ?? (() => window.location.assign('/login?expired=1')))();
      return;
    }
    setError(e);
  }
  async function save(patch: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setDraft(await saveDraft(api, kind, draft, patch));
      setPhase('preview');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (busy || !draft || !draft.complete) return;
    setBusy(true);
    setError(null);
    const k = keyRef.current;
    const key = k && k.draftId === draft.draft.id && k.version === draft.draft.version ? k.key : newIdempotencyKey();
    keyRef.current = { draftId: draft.draft.id, version: draft.draft.version, key };
    try {
      const result = await publishDraft(api, draft, key);
      const go = props.onPublished ?? ((r: PublishResult) => window.location.assign(kind === 'PURCHASE_DEMAND' ? `/demands/${r.entity_id}` : `/services/${r.entity_id}`));
      go(result);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return { draft, phase, setPhase, busy, error, save, publish };
}

function ErrorBlock({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiRequestError ? error.messageTh : 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  const stale = error instanceof ApiRequestError && error.code === 'STALE_VERSION';
  return (
    <Notice tone="error">
      <p>{message}</p>
      {stale ? <p className="mt-1">ข้อมูลถูกแก้จากที่อื่น กรุณาโหลดหน้านี้ใหม่</p> : null}
    </Notice>
  );
}

function Preview(props: {
  title: string;
  rows: { label: string; value: ReactNode }[];
  draft: DraftView;
  busy: boolean;
  error: unknown;
  onBack: () => void;
  onPublish: () => void;
}) {
  const { draft } = props;
  return (
    <section aria-label="ตรวจก่อนประกาศ" className="space-y-4">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {draft.complete ? (
        <Notice tone="success">ข้อมูลครบแล้ว กดประกาศเมื่อพร้อม</Notice>
      ) : (
        <Notice tone="warning" title="ยังประกาศไม่ได้">
          <p>ข้อมูลที่ยังขาดหรือไม่ถูกต้อง:</p>
          <ul data-testid="missing-fields" className="mt-1 list-disc pl-5">
            {[...new Set(draft.missing_fields.map(fieldLabel))].map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Notice>
      )}
      <dl className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        {props.rows.map((r) => (
          <Field key={r.label} label={r.label}>
            {r.value}
          </Field>
        ))}
      </dl>
      <p className="text-xs text-slate-600">
        ข้อมูลนี้เป็นสิ่งที่คุณกรอกเอง ผลจับคู่และรายได้ที่ระบบคำนวณเป็น <EstimateLabel /> ไม่ใช่ราคาที่ผู้ซื้อยืนยัน
      </p>
      <ErrorBlock error={props.error} />
      <div className="flex flex-col gap-2 min-[400px]:flex-row">
        <button type="button" className={`${SECONDARY_BUTTON} flex-1`} onClick={props.onBack} disabled={props.busy}>
          กลับไปแก้ไข
        </button>
        <button type="button" className={`${BUTTON_CLASS} flex-1`} onClick={props.onPublish} disabled={props.busy || !draft.complete}>
          {props.busy ? 'กำลังส่ง…' : 'ประกาศ'}
        </button>
      </div>
    </section>
  );
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const priceRow = (d: Record<string, unknown>, field: string) =>
  formatPostingPrice(d.price_mode === 'FIXED' ? 'FIXED' : 'NEGOTIABLE', str(d[field]), (str(d.price_unit) as 'KG' | 'TON' | 'BALE' | null));

// ---- purchase demand --------------------------------------------------------------------------
export function DemandForm(props: Omit<PostingFormProps, 'kind'> & { resale?: boolean }) {
  const flow = useSubmitFlow('PURCHASE_DEMAND', { ...props, kind: 'PURCHASE_DEMAND' });
  const [f, setF] = useState<DemandFormState>(emptyDemandForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const set = <K extends keyof DemandFormState>(k: K, v: DemandFormState[K]) => setF((s) => ({ ...s, [k]: v }));

  function review() {
    const r = buildDemandPatch(f);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    void flow.save(r.patch);
  }

  if (flow.phase === 'preview' && flow.draft) {
    const d = flow.draft.draft.data;
    const forms = (Array.isArray(d.accepted_forms) ? d.accepted_forms : []) as MaterialForm[];
    const q = qualityLines((d.quality ?? {}) as Record<string, unknown>);
    return (
      <Preview
        title="ตรวจความต้องการรับซื้อ"
        draft={flow.draft}
        busy={flow.busy}
        error={flow.error}
        onBack={() => flow.setPhase('edit')}
        onPublish={() => void flow.publish()}
        rows={[
          { label: 'วัสดุ', value: materialsText(strs(d.accepted_materials) as MaterialType[]) },
          { label: 'รูปแบบ', value: forms.length ? forms.map((x) => FORM_LABEL[x]).join(', ') : 'ไม่ระบุ' },
          { label: 'ปริมาณที่ต้องการ', value: str(d.target_qty_kg) ? formatKg(String(d.target_qty_kg)) : '-' },
          { label: 'ขั้นต่ำต่อรอบ', value: str(d.min_lot_kg) ? formatKg(String(d.min_lot_kg)) : 'ไม่ระบุ' },
          { label: 'ราคา', value: priceRow(d, 'max_unit_price_thb') },
          { label: 'จังหวัด', value: [str(d.district), str(d.province)].filter(Boolean).join(' ') || '-' },
          { label: 'รัศมีรับซื้อ', value: str(d.radius_km) ? `${d.radius_km} กม.` : 'ไม่ระบุ' },
          { label: 'จังหวัดที่รับ', value: strs(d.accepted_provinces).join(', ') || 'ไม่ระบุ' },
          { label: 'ช่วงเวลา', value: windowText(str(d.window_from), str(d.window_to)) },
          {
            label: 'เงื่อนไขคุณภาพ',
            value: q.length ? (
              <ul>
                {q.map((l) => (
                  <li key={l.label}>
                    {l.label}: {l.value}
                    {l.needsVerify ? <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-900">{VERIFY_LABEL}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              'ไม่ระบุ'
            ),
          },
          { label: 'การขนส่ง', value: d.transport_by ? TRANSPORT_LABEL[d.transport_by as TransportBy] : 'ไม่ระบุ' },
          { label: 'รับวัสดุที่ยังไม่พร้อม (ขายต่อ)', value: d.accepts_pending_material === true ? 'รับ' : 'ไม่รับ' },
        ]}
      />
    );
  }

  return (
    <form
      aria-label="ความต้องการรับซื้อ"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      {props.resale ? <Notice tone="info">โหมด: รับซื้อเพื่อขายต่อ</Notice> : null}
      <MaterialSection
        label="วัสดุที่รับซื้อ"
        values={f.materials}
        acknowledged={f.otherAcknowledged}
        error={errors.materials}
        onValues={(v) => set('materials', v)}
        onAcknowledged={(v) => set('otherAcknowledged', v)}
      />
      <CheckChoice
        label="รูปแบบวัสดุ"
        name="forms"
        values={f.forms}
        options={[{ value: 'LOOSE' as MaterialForm, label: FORM_LABEL.LOOSE }, { value: 'BALED' as MaterialForm, label: FORM_LABEL.BALED }]}
        onChange={(v) => set('forms', v)}
      />
      <AmountInput label="ปริมาณที่ต้องการ" amount={f.qty} unit={f.qtyUnit} units={KG_TON_UNITS} onAmount={(v) => set('qty', v)} onUnit={(u) => set('qtyUnit', u)} error={errors.target_quantity} />
      <AmountInput label="ขั้นต่ำต่อรอบ (ถ้ามี)" amount={f.minLot} unit={f.minLotUnit} units={KG_TON_UNITS} onAmount={(v) => set('minLot', v)} onUnit={(u) => set('minLotUnit', u)} error={errors.min_lot} />
      <PriceSection
        modeLabel="ราคารับซื้อ"
        mode={f.priceMode}
        amount={f.price}
        unit={f.priceUnit}
        units={[{ value: 'ton', label: 'บาท/ตัน' }, { value: 'kg', label: 'บาท/กก.' }]}
        errors={errors}
        onMode={(m) => set('priceMode', m)}
        onAmount={(v) => set('price', v)}
        onUnit={(u) => set('priceUnit', u)}
      />
      <ProvinceSelect label="จังหวัดที่ตั้ง" value={f.province} onChange={(v) => setF((s) => ({ ...s, province: v, district: '' }))} error={errors.province} />
      <DistrictSelect province={f.province} value={f.district} onChange={(v) => set('district', v)} />
      <RadiusSelect value={f.radius} onChange={(v) => set('radius', v)} error={errors.radius_km} />
      <ProvinceChecks name="accepted_provinces" label="จังหวัดที่รับ" values={f.provinces} onChange={(v) => set('provinces', v)} error={errors.accepted_provinces} />
      <TextInput label="รับตั้งแต่วันที่" type="date" value={f.from} onChange={(v) => set('from', v)} />
      <TextInput label="รับถึงวันที่" type="date" value={f.to} onChange={(v) => set('to', v)} error={errors.window_to} />
      <FieldGroup label="เงื่อนไขคุณภาพ" hint={`ติ๊ก "${VERIFY_LABEL}" ถ้าต้องมีการตรวจก่อนรับ`}>
        <div className="space-y-3">
          {QUALITY_FIELDS.map((q) => (
            <div key={q.key} className="space-y-1">
              <TextInput
                label={q.label}
                inputMode={q.inputMode}
                value={f.quality[q.key].value}
                error={errors[`quality.${q.key}`]}
                onChange={(v) => set('quality', { ...f.quality, [q.key]: { ...f.quality[q.key], value: v } })}
              />
              <CheckBox
                label={`${VERIFY_LABEL}: ${q.label}`}
                checked={f.quality[q.key].verify}
                onChange={(on) => set('quality', { ...f.quality, [q.key]: { ...f.quality[q.key], verify: on } })}
              />
            </div>
          ))}
        </div>
      </FieldGroup>
      <RadioChoice label="ใครรับผิดชอบการขนส่ง" name="transport_by" value={f.transport} options={TRANSPORT_CHOICES} onChange={(v) => set('transport', v)} error={errors.transport_by} />
      <CheckBox label="รับวัสดุที่ยังไม่พร้อม (ขายต่อ)" checked={f.acceptsPending} onChange={(v) => set('acceptsPending', v)} />
      {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}
      <ErrorBlock error={flow.error} />
      <button type="submit" className={`${BUTTON_CLASS} w-full`} disabled={flow.busy}>
        {flow.busy ? 'กำลังบันทึก…' : 'ตรวจก่อนประกาศ'}
      </button>
    </form>
  );
}

// ---- baling service ---------------------------------------------------------------------------
const MODE_CHOICES = (['ON_SITE', 'AT_FACTORY', 'BOTH'] as const).map((v) => ({ value: v as ServiceMode, label: SERVICE_MODE_LABEL[v] }));

export function ServiceForm(props: Omit<PostingFormProps, 'kind'>) {
  const flow = useSubmitFlow('BALING_SERVICE', { ...props, kind: 'BALING_SERVICE' });
  const [f, setF] = useState<ServiceFormState>(emptyServiceForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const set = <K extends keyof ServiceFormState>(k: K, v: ServiceFormState[K]) => setF((s) => ({ ...s, [k]: v }));

  function review() {
    const r = buildServicePatch(f);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    void flow.save(r.patch);
  }

  if (flow.phase === 'preview' && flow.draft) {
    const d = flow.draft.draft.data;
    return (
      <Preview
        title="ตรวจบริการรับจ้างอัด"
        draft={flow.draft}
        busy={flow.busy}
        error={flow.error}
        onBack={() => flow.setPhase('edit')}
        onPublish={() => void flow.publish()}
        rows={[
          { label: 'วัสดุที่รับอัด', value: materialsText(strs(d.material_types) as MaterialType[]) },
          { label: 'รูปแบบบริการ', value: d.service_mode ? SERVICE_MODE_LABEL[d.service_mode as ServiceMode] : '-' },
          { label: 'รูปแบบก้อน', value: str(d.baling_format) ?? 'ไม่ระบุ' },
          { label: 'ปริมาณขั้นต่ำ', value: str(d.min_qty_kg) ? formatKg(String(d.min_qty_kg)) : 'ไม่ระบุ' },
          { label: 'กำลังอัดต่อรอบ', value: str(d.capacity_kg) ? formatKg(String(d.capacity_kg)) : 'ไม่ระบุ' },
          { label: 'ค่าบริการ', value: priceRow(d, 'unit_price_thb') },
          { label: 'จังหวัด', value: [str(d.district), str(d.province)].filter(Boolean).join(' ') || '-' },
          { label: 'จังหวัดที่ให้บริการ', value: strs(d.service_provinces).join(', ') || 'ไม่ระบุ' },
          { label: 'ช่วงเวลา', value: windowText(str(d.available_from), str(d.available_to)) },
          { label: 'การขนส่ง', value: d.transport_by ? TRANSPORT_LABEL[d.transport_by as TransportBy] : 'ไม่ระบุ' },
        ]}
      />
    );
  }

  return (
    <form
      aria-label="บริการรับจ้างอัด"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      <MaterialSection
        label="วัสดุที่รับอัด"
        values={f.materials}
        acknowledged={f.otherAcknowledged}
        error={errors.materials}
        onValues={(v) => set('materials', v)}
        onAcknowledged={(v) => set('otherAcknowledged', v)}
      />
      <RadioChoice label="รูปแบบบริการ" name="service_mode" value={f.mode} options={MODE_CHOICES} onChange={(v) => set('mode', v)} error={errors.service_mode} />
      <TextInput label="รูปแบบก้อน (ถ้ามี)" value={f.balingFormat} onChange={(v) => set('balingFormat', v)} />
      <AmountInput label="ปริมาณขั้นต่ำ (ถ้ามี)" amount={f.minQty} unit={f.minQtyUnit} units={KG_TON_UNITS} onAmount={(v) => set('minQty', v)} onUnit={(u) => set('minQtyUnit', u)} error={errors.min_quantity} />
      <AmountInput label="กำลังอัดต่อรอบ (ถ้ามี)" amount={f.capacity} unit={f.capacityUnit} units={KG_TON_UNITS} onAmount={(v) => set('capacity', v)} onUnit={(u) => set('capacityUnit', u)} error={errors.capacity} />
      <PriceSection
        modeLabel="ค่าบริการ"
        mode={f.priceMode}
        amount={f.price}
        unit={f.priceUnit}
        units={[{ value: 'bale', label: 'บาท/ก้อน' }, { value: 'ton', label: 'บาท/ตัน' }, { value: 'kg', label: 'บาท/กก.' }]}
        errors={errors}
        onMode={(m) => set('priceMode', m)}
        onAmount={(v) => set('price', v)}
        onUnit={(u) => set('priceUnit', u)}
      />
      <ProvinceSelect label="จังหวัดที่ตั้ง" value={f.province} onChange={(v) => setF((s) => ({ ...s, province: v, district: '' }))} error={errors.province} />
      <DistrictSelect province={f.province} value={f.district} onChange={(v) => set('district', v)} />
      <ProvinceChecks name="service_provinces" label="จังหวัดที่ให้บริการ" values={f.provinces} onChange={(v) => set('provinces', v)} error={errors.service_provinces} />
      <TextInput label="ให้บริการตั้งแต่วันที่" type="date" value={f.from} onChange={(v) => set('from', v)} />
      <TextInput label="ให้บริการถึงวันที่" type="date" value={f.to} onChange={(v) => set('to', v)} error={errors.available_to} />
      <RadioChoice label="ใครรับผิดชอบการขนส่ง" name="transport_by" value={f.transport} options={TRANSPORT_CHOICES} onChange={(v) => set('transport', v)} error={errors.transport_by} />
      {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}
      <ErrorBlock error={flow.error} />
      <button type="submit" className={`${BUTTON_CLASS} w-full`} disabled={flow.busy}>
        {flow.busy ? 'กำลังบันทึก…' : 'ตรวจก่อนประกาศ'}
      </button>
    </form>
  );
}
