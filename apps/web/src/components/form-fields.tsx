'use client';
import type { ReactNode } from 'react';

const INPUT =
  'min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700';

export function FieldGroup({ label, error, hint, children, id }: { label: string; error?: string | undefined; hint?: string | undefined; children: ReactNode; id?: string | undefined }) {
  return (
    <fieldset className="min-w-0 space-y-2" data-field={id}>
      <legend className="text-sm font-medium text-slate-800">{label}</legend>
      {hint ? <p className="text-xs text-slate-600">{hint}</p> : null}
      {children}
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function TextInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  inputMode?: 'text' | 'decimal' | 'numeric';
  type?: 'text' | 'date';
  placeholder?: string | undefined;
}) {
  const { label, value, onChange, error, hint, inputMode = 'text', type = 'text', placeholder } = props;
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      {hint ? <span className="block text-xs text-slate-600">{hint}</span> : null}
      <input
        type={type}
        inputMode={type === 'date' ? undefined : inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={INPUT}
      />
      {error ? (
        <span role="alert" className="block text-sm text-red-800">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/** One choice per row, 44 px tall. `value` null means nothing is chosen yet. */
export function RadioChoice<T extends string>(props: {
  label: string;
  name: string;
  value: T | '';
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  error?: string | undefined;
}) {
  const { label, name, value, options, onChange, error } = props;
  return (
    <FieldGroup label={label} error={error} id={name}>
      <div className="space-y-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 has-[:checked]:border-emerald-700 has-[:checked]:bg-emerald-50"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-5 w-5 shrink-0 accent-emerald-700"
            />
            <span className="min-w-0 break-words text-base">
              {o.label}
              {o.hint ? <span className="block text-xs text-slate-600">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </FieldGroup>
  );
}

export function CheckChoice<T extends string>(props: {
  label: string;
  name: string;
  values: readonly T[];
  options: readonly { value: T; label: string }[];
  onChange: (v: T[]) => void;
  error?: string | undefined;
}) {
  const { label, name, values, options, onChange, error } = props;
  return (
    <FieldGroup label={label} error={error} id={name}>
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        {options.map((o) => (
          <CheckBox
            key={o.value}
            label={o.label}
            checked={values.includes(o.value)}
            onChange={(on) => onChange(on ? [...values, o.value] : values.filter((v) => v !== o.value))}
          />
        ))}
      </div>
    </FieldGroup>
  );
}

export function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 has-[:checked]:border-emerald-700 has-[:checked]:bg-emerald-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-emerald-700"
      />
      <span className="min-w-0 break-words text-base">{label}</span>
    </label>
  );
}

/** Amount plus a unit select limited to the given units (quantities: kg or ton only). */
export function AmountInput<U extends string>(props: {
  label: string;
  amount: string;
  unit: U;
  units: readonly { value: U; label: string }[];
  onAmount: (v: string) => void;
  onUnit: (u: U) => void;
  error?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const { label, amount, unit, units, onAmount, onUnit, error, hint, disabled } = props;
  return (
    <FieldGroup label={label} error={error} hint={hint}>
      <div className="flex gap-2">
        <input
          aria-label={`${label} จำนวน`}
          inputMode="decimal"
          value={amount}
          disabled={disabled}
          onChange={(e) => onAmount(e.target.value)}
          aria-invalid={error ? true : undefined}
          className={`${INPUT} flex-1 basis-0`}
        />
        <select
          aria-label={`${label} หน่วย`}
          value={unit}
          disabled={disabled}
          onChange={(e) => onUnit(e.target.value as U)}
          // Fixed width: INPUT carries w-full, which would otherwise win over w-auto and squeeze the number box to 0.
          className={`${INPUT.replace('w-full', 'w-28')} shrink-0`}
        >
          {units.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
    </FieldGroup>
  );
}

export const KG_TON_UNITS = [
  { value: 'ton', label: 'ตัน' },
  { value: 'kg', label: 'กก.' },
] as const;
