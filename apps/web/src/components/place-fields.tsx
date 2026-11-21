'use client';
import type { ReactNode } from 'react';
import { DISTRICTS_BY_PROVINCE, MAX_PROVINCE_CHOICES, PILOT_PROVINCE_NAMES, RADIUS_KM_OPTIONS, THAI_PROVINCES } from '@agrimatch/contracts';
import { FieldGroup } from './form-fields';

const SELECT =
  'min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:bg-slate-100 disabled:text-slate-600';
const PILOT = new Set<string>(PILOT_PROVINCE_NAMES);
const OTHER_PROVINCES = THAI_PROVINCES.filter((p) => !PILOT.has(p));

function SelectShell(props: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  value: string;
  disabled?: boolean | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-sm font-medium text-slate-800">{props.label}</span>
      {props.hint ? <span className="block text-xs text-slate-600">{props.hint}</span> : null}
      <select
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.error ? true : undefined}
        className={SELECT}
      >
        {props.children}
      </select>
      {props.error ? (
        <span role="alert" className="block text-sm text-red-800">
          {props.error}
        </span>
      ) : null}
    </label>
  );
}

/** A saved value that is not in the list (legacy free text) stays selectable so it displays and saves unchanged. */
const isLegacy = (value: string, known: readonly string[]) => value !== '' && !known.includes(value);

export function ProvinceSelect(props: { label: string; value: string; onChange: (v: string) => void; error?: string | undefined; hint?: string | undefined }) {
  const { value } = props;
  return (
    <SelectShell label={props.label} hint={props.hint} error={props.error} value={value} onChange={props.onChange}>
      <option value="">เลือกจังหวัด</option>
      {isLegacy(value, THAI_PROVINCES) ? <option value={value}>{value}</option> : null}
      <optgroup label="จังหวัดนำร่อง">
        {PILOT_PROVINCE_NAMES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </optgroup>
      <optgroup label="จังหวัดอื่น">
        {OTHER_PROVINCES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </optgroup>
    </SelectShell>
  );
}

/** Depends on the province. Only the pilot provinces have district data; others show a disabled «ไม่ระบุ». */
export function DistrictSelect(props: { province: string; value: string; onChange: (v: string) => void }) {
  const districts = DISTRICTS_BY_PROVINCE[props.province] ?? [];
  const legacy = isLegacy(props.value, districts);
  const noData = districts.length === 0 && !legacy;
  return (
    <SelectShell label="อำเภอ (ถ้ามี)" value={props.value} disabled={noData} onChange={props.onChange}>
      {noData ? (
        <option value="" disabled>
          ไม่ระบุ
        </option>
      ) : (
        <>
          <option value="">ไม่ระบุ</option>
          {legacy ? <option value={props.value}>{props.value}</option> : null}
          {districts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </>
      )}
    </SelectShell>
  );
}

export function RadiusSelect(props: { value: string; onChange: (v: string) => void; error?: string | undefined }) {
  const legacy = isLegacy(props.value, RADIUS_KM_OPTIONS);
  return (
    <SelectShell label="รัศมีรับซื้อ (กม.)" hint="ระบบจับคู่ระยะขนส่งไม่เกิน 80 กม." value={props.value} error={props.error} onChange={props.onChange}>
      <option value="">ไม่ระบุ</option>
      {legacy ? <option value={props.value}>{props.value} กม.</option> : null}
      {RADIUS_KM_OPTIONS.map((r) => (
        <option key={r} value={r}>
          {r} กม.
        </option>
      ))}
    </SelectShell>
  );
}

/** Checkbox multi-select of provinces, at most 10. Saved values outside the list are listed first and stay checked. */
export function ProvinceChecks(props: { label: string; values: readonly string[]; onChange: (v: string[]) => void; error?: string | undefined; name: string }) {
  const { values } = props;
  const atLimit = values.length >= MAX_PROVINCE_CHOICES;
  const options = [...values.filter((v) => !(THAI_PROVINCES as readonly string[]).includes(v)), ...PILOT_PROVINCE_NAMES, ...OTHER_PROVINCES];
  return (
    <FieldGroup label={props.label} error={props.error} id={props.name} hint={`เลือกได้ไม่เกิน ${MAX_PROVINCE_CHOICES} จังหวัด (เลือกแล้ว ${values.length})`}>
      {atLimit ? (
        <p role="status" className="text-sm text-amber-900">
          เลือกครบ {MAX_PROVINCE_CHOICES} จังหวัดแล้ว ยกเลิกบางจังหวัดก่อนเลือกเพิ่ม
        </p>
      ) : null}
      <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto min-[400px]:grid-cols-2">
        {options.map((p) => {
          const checked = values.includes(p);
          return (
            <label
              key={p}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 has-[:checked]:border-emerald-700 has-[:checked]:bg-emerald-50 has-[:disabled]:opacity-50"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && atLimit}
                onChange={(e) => props.onChange(e.target.checked ? [...values, p] : values.filter((v) => v !== p))}
                className="h-5 w-5 shrink-0 accent-emerald-700"
              />
              <span className="min-w-0 break-words text-base">{p}</span>
            </label>
          );
        })}
      </div>
    </FieldGroup>
  );
}
