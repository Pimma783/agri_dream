// Degraded step-form mode (task 10.5, Requirement 4.11, 6.9, 16.9; design.md "degraded mode").
// Used when AI_MODE is disabled or Bedrock failed after its own retries. No model is called. The form walks a fixed
// question list per draft kind, reads answers with deterministic parsers (domain/step-parsers.ts), and writes only
// through the draft service with expectedVersion. It never publishes: when the draft is complete it returns a
// structured preview and the channel renders the human buttons «ยืนยันเผยแพร่» / «แก้ไข» / «เก็บร่าง».
// State is not kept anywhere new: the position in the form comes from the draft's data (first missing step) and from
// the last question this form sent (stored as the previous OUT message).
import { detectMenuIntent } from '../domain/menu-intents.js';
import type { Actor, Role } from '../domain/permissions.js';
import {
  bangkokDate, endOfBangkokDayIso, matchAliases, MATERIAL_ALIASES, normalizeText, parseDate, parsePrice, parseProvince,
  parseQuantity, PILOT_PROVINCES, PRICE_MODE_ALIASES, provinceLabelTh, READY_ALIASES, REQUESTED_MODE_ALIASES,
  SERVICE_MODE_ALIASES, startOfBangkokDayIso, type Alias,
} from '../domain/step-parsers.js';
import type { ConversationService, DraftService, DraftView, Message } from '../services/index.js';
import type { AssistantReply, DegradedInput, StepPreview } from './orchestrator.js';
import { KIND_LABEL_TH, TEXT } from './prompts.js';
import type { DraftKind } from './schemas.js';
import { summarize } from './tools.js';

export interface StepFormClock {
  now(): Date;
}
export interface StepFormDeps {
  drafts: DraftService;
  conversations: ConversationService;
  /** Resolves "พรุ่งนี้" and similar phrases. Inject a fixed clock in tests. */
  clock?: StepFormClock;
}
export type StepFormReply = Pick<AssistantReply, 'text'> & Partial<AssistantReply>;

/** Main menu buttons for a farmer. The LINE handler uses the same labels. */
export const FARMER_MAIN_MENU: readonly string[] = ['ลงขายวัสดุ', 'หาผู้รับอัด', 'รายการของฉัน', 'ข้อเสนอ', 'ช่วยเหลือ'];

type Data = Record<string, unknown>;
type StepType = 'location' | 'material' | 'materials' | 'quantity' | 'price_mode' | 'price' | 'province' | 'service_mode' | 'requested_mode' | 'ready' | 'date_from' | 'date_to' | 'date';

export interface Step {
  /** Patch key sent to the draft service. */
  key: string;
  type: StepType;
  label: string;
  prompt: string;
  /** Key in stored draft data that tells the step is answered. */
  stored: string;
  /** Skipped (not asked, not required) when false. */
  when?: (d: Data) => boolean;
  /** Only reachable through «แก้ไข»; the draft is complete without it. */
  optional?: boolean;
  allowBale?: boolean;
  /** Stored key of the paired start date, to keep end >= start. */
  pairedStart?: string;
}

const QTY_PROMPT = 'ระบุเป็น กก. หรือ ตัน เช่น 5 ตัน หรือ 5000 กก.';
const PRICE_PROMPT = 'เช่น 2 บาท/กก. หรือ 1500 บาท/ตัน';
const DATE_PROMPT = 'เช่น 2026-03-05 หรือ พรุ่งนี้';
const isFixed = (d: Data): boolean => d.price_mode === 'FIXED';

const priceStep = (key: string, prompt: string, stored: string, allowBale = false): Step => ({
  key, type: 'price', label: 'ราคา', prompt: `${prompt} ${allowBale ? 'เช่น 80 บาท/มัด หรือ 2 บาท/กก.' : PRICE_PROMPT}`, stored, when: isFixed, allowBale,
});
const provinceStep: Step = {
  key: 'province', type: 'province', label: 'จังหวัด', prompt: 'อยู่จังหวัดไหน? (พื้นที่นำร่อง: อุตรดิตถ์ นครสวรรค์ กำแพงเพชร)', stored: 'province',
};
/** Optional: asked once right after the province, answered with a LINE location button or «ข้าม». Only user-sent coordinates are stored. */
const locationStep: Step = {
  key: 'location', type: 'location', label: 'ตำแหน่ง', prompt: 'ส่งตำแหน่งที่ตั้งได้ เพื่อให้คำนวณระยะทางเส้นตรงถึงผู้รับซื้อ หรือกด «ข้าม»',
  stored: 'lat', optional: true,
};
const priceModeStep: Step = {
  key: 'price_mode', type: 'price_mode', label: 'รูปแบบราคา', prompt: 'ราคาตายตัวหรือต่อรองได้?', stored: 'price_mode',
};
const dateSteps = (from: string, to: string, what: string): Step[] => [
  { key: from, type: 'date_from', label: `${what}เริ่ม`, prompt: `${what}เริ่มวันที่เท่าไร? ${DATE_PROMPT}`, stored: from, optional: true },
  { key: to, type: 'date_to', label: `${what}สิ้นสุด`, prompt: `${what}สิ้นสุดวันที่เท่าไร? ${DATE_PROMPT}`, stored: to, optional: true, pairedStart: from },
];

const SALE_STEPS: Step[] = [
  { key: 'material_type', type: 'material', label: 'ชนิดวัสดุ', prompt: 'วัสดุอะไร?', stored: 'material_type' },
  { key: 'quantity', type: 'quantity', label: 'ปริมาณ', prompt: `มีปริมาณเท่าไร? ${QTY_PROMPT}`, stored: 'qty_kg' },
  priceModeStep,
  priceStep('price', 'ราคาที่ขายเท่าไร?', 'unit_price_thb'),
  provinceStep,
  locationStep,
  ...dateSteps('available_from', 'available_to', 'พร้อมขาย'),
];

/** Fixed question lists per draft kind (field order). */
export const STEP_FORMS: Readonly<Record<DraftKind, readonly Step[]>> = {
  SALE_LISTING: SALE_STEPS,
  RESALE_LISTING: [
    ...SALE_STEPS.slice(0, 6),
    { key: 'pending_material', type: 'ready', label: 'วัสดุพร้อมหรือยัง', prompt: 'วัสดุพร้อมส่งแล้วหรือยัง?', stored: 'pending_material' },
    {
      key: 'expected_ready_at', type: 'date', label: 'วันที่วัสดุพร้อม', prompt: `วัสดุจะพร้อมวันที่เท่าไร? ${DATE_PROMPT}`,
      stored: 'expected_ready_at', when: (d) => d.pending_material === true,
    },
    ...SALE_STEPS.slice(6),
  ],
  PURCHASE_DEMAND: [
    { key: 'accepted_materials', type: 'materials', label: 'ชนิดวัสดุที่รับ', prompt: 'รับซื้อวัสดุอะไร? (เลือกได้หลายอย่าง)', stored: 'accepted_materials' },
    { key: 'target_quantity', type: 'quantity', label: 'ปริมาณที่ต้องการ', prompt: `ต้องการปริมาณเท่าไร? ${QTY_PROMPT}`, stored: 'target_qty_kg' },
    priceModeStep,
    priceStep('price', 'ราคารับซื้อสูงสุดเท่าไร?', 'max_unit_price_thb'),
    provinceStep,
    locationStep,
    ...dateSteps('window_from', 'window_to', 'รับซื้อ'),
  ],
  BALING_SERVICE: [
    { key: 'material_types', type: 'materials', label: 'ชนิดวัสดุที่อัด', prompt: 'อัดวัสดุอะไรได้บ้าง? (เลือกได้หลายอย่าง)', stored: 'material_types' },
    { key: 'service_mode', type: 'service_mode', label: 'รูปแบบบริการ', prompt: 'ให้บริการที่แปลง ที่โรงงาน หรือทั้งสองแบบ?', stored: 'service_mode' },
    priceModeStep,
    priceStep('price', 'ค่าบริการเท่าไร?', 'unit_price_thb', true),
    provinceStep,
    locationStep,
    ...dateSteps('available_from', 'available_to', 'ให้บริการ'),
  ],
  BALING_REQUEST: [
    { key: 'material_type', type: 'material', label: 'ชนิดวัสดุ', prompt: 'วัสดุอะไรที่ต้องการให้อัด?', stored: 'material_type' },
    { key: 'quantity', type: 'quantity', label: 'ปริมาณ', prompt: `มีปริมาณเท่าไร? ${QTY_PROMPT}`, stored: 'qty_kg' },
    { key: 'requested_mode', type: 'requested_mode', label: 'รูปแบบที่ต้องการ', prompt: 'ให้อัดที่แปลงหรือที่โรงงาน?', stored: 'requested_mode' },
    provinceStep,
    locationStep,
    ...dateSteps('needed_from', 'needed_to', 'ต้องการ'),
  ],
};

/**
 * Kinds the form offers per role, in menu order. This only shapes the menu: the draft service still authorizes every
 * create and patch, so a mismatch ends in FORBIDDEN, never in a write. RESALE starts from an agreement only.
 */
const START_KINDS: Readonly<Record<Role, readonly DraftKind[]>> = {
  FARMER: ['SALE_LISTING', 'BALING_REQUEST'],
  BALER: ['SALE_LISTING', 'PURCHASE_DEMAND', 'BALING_SERVICE'],
  BUYER_FACTORY: ['PURCHASE_DEMAND'],
};

const T = {
  /** Shown on the first form message of a conversation only. */
  notice: 'โหมดถามทีละข้อ',
  chooseKind: 'ต้องการทำรายการอะไร? เลือกจากปุ่มด้านล่าง',
  resume: 'ยังมีร่างที่กรอกไม่เสร็จ กรอกต่อได้เลย หรือพิมพ์ «ยกเลิก» เพื่อเริ่มใหม่',
  needLocation: 'กดปุ่มส่งตำแหน่งด้านล่าง หรือกด «ข้าม»',
  saved: 'บันทึกแล้ว (ยังไม่ได้เผยแพร่)',
  noWrite: 'ยังไม่ได้บันทึกอะไร',
  editMenu: 'ต้องการแก้ไขข้อไหน?',
  keep: 'เก็บร่างไว้แล้ว ยังไม่ได้เผยแพร่ กลับมากรอกต่อได้ทุกเมื่อ',
  pressButton: 'การเผยแพร่ต้องกดปุ่ม «ยืนยันเผยแพร่» เองเท่านั้น พิมพ์ข้อความยืนยันไม่ได้',
  unitAsk: 'ขอปริมาณหรือราคาเป็น กก. หรือ ตัน',
  readQty: `อ่านปริมาณไม่ได้ ${QTY_PROMPT}`,
  noQtyUnit: 'ยังไม่เห็นหน่วย ขอเป็น กก. หรือ ตัน',
  readPrice: 'อ่านราคาไม่ได้',
  noPriceUnit: 'ยังไม่เห็นหน่วยราคา ขอเป็นต่อ กก. หรือ ต่อตัน',
  readChoice: 'ยังไม่เข้าใจตัวเลือก กรุณาเลือกจากปุ่มหรือพิมพ์ให้ตรงตัวเลือก',
  readProvince: 'ตอนนี้รองรับเฉพาะพื้นที่นำร่อง กรุณาเลือกจังหวัดจากปุ่ม',
  dateAmbiguous: 'วันที่ยังไม่ชัดเจน กรุณาระบุเป็นวันที่เต็ม',
  dateInvalid: 'วันที่ไม่ถูกต้อง',
  datePast: 'วันที่นี้ผ่านมาแล้ว',
  dateOrder: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม',
} as const;

export const LOCATION_SHARED_TEXT = 'ส่งตำแหน่งแล้ว';
const SKIP = 'ข้าม';
const EDIT = 'แก้ไข';
const KEEP = 'เก็บร่าง';
const CONFIRM = 'ยืนยันเผยแพร่';
const ACTIONS: StepPreview['actions'] = [
  { id: 'CONFIRM_PUBLISH', label: CONFIRM },
  { id: 'EDIT', label: EDIT },
  { id: 'KEEP_DRAFT', label: KEEP },
];

export const MATERIAL_LABEL: Readonly<Record<string, string>> = {
  RICE_STRAW: 'ฟางข้าว', CANE_LEAF: 'ใบอ้อย', CORN_COB: 'ซังข้าวโพด', OTHER: 'อื่นๆ',
};
const MATERIAL_BUTTONS = ['ฟางข้าว', 'ใบอ้อย', 'ซังข้าวโพด', 'อื่นๆ'];
const MODE_LABEL: Readonly<Record<string, string>> = {
  ON_SITE: 'ที่แปลง', AT_FACTORY: 'ที่โรงงาน', BOTH: 'ทั้งสองแบบ', FIXED: 'ราคาตายตัว', NEGOTIABLE: 'ต่อรองได้',
};
const UNIT_LABEL: Readonly<Record<string, string>> = { KG: 'กก.', TON: 'ตัน', BALE: 'มัด' };

function quickRepliesOf(step: Step): string[] | undefined {
  switch (step.type) {
    case 'material':
      return MATERIAL_BUTTONS;
    case 'materials':
      return [...MATERIAL_BUTTONS, 'ทุกชนิด'];
    case 'price_mode':
      return ['ราคาตายตัว', 'ต่อรองได้'];
    case 'province':
      return PILOT_PROVINCES.map((p) => p.th);
    case 'location':
      return [SKIP];
    case 'service_mode':
      return ['ที่แปลง', 'ที่โรงงาน', 'ทั้งสองแบบ'];
    case 'requested_mode':
      return ['ที่แปลง', 'ที่โรงงาน'];
    case 'ready':
      return ['พร้อมแล้ว', 'ยังไม่พร้อม'];
    case 'date_from':
    case 'date_to':
    case 'date':
      return ['วันนี้', 'พรุ่งนี้'];
    default:
      return undefined;
  }
}

const active = (steps: readonly Step[], data: Data): Step[] => steps.filter((s) => !s.when || s.when(data));
const answered = (s: Step, data: Data): boolean => data[s.stored] !== undefined;
const firstMissing = (kind: DraftKind, data: Data): Step | undefined =>
  active(STEP_FORMS[kind], data).find((s) => !s.optional && !answered(s, data));

/** The step whose question was the last line of the previous OUT message. */
function pendingStep(kind: DraftKind, lastOut: Message | undefined): Step | undefined {
  const last = (lastOut?.text ?? '').trimEnd().split('\n').pop() ?? '';
  return STEP_FORMS[kind].find((s) => last === s.prompt);
}

const ask = (step: Step, head?: string, extra: Partial<StepFormReply> = {}): StepFormReply => {
  const qr = quickRepliesOf(step);
  return {
    text: head ? `${head}\n${step.prompt}` : step.prompt,
    noWrite: true, confirmable: false,
    ...(qr ? { quickReplies: qr } : {}),
    ...(step.type === 'location' ? { requestLocation: true } : {}),
    ...extra,
  };
};

// ---- formatting ---------------------------------------------------------------------------------
function fmtNumber(s: string): string {
  const [int = '', frac] = s.split('.');
  const trimmed = (frac ?? '').replace(/0+$/, '');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${trimmed ? `.${trimmed}` : ''}`;
}
const fmtDate = (iso: unknown): string => (typeof iso === 'string' ? bangkokDate(new Date(iso)) : '');

function valueOf(step: Step, d: Data): string {
  const v = d[step.stored];
  switch (step.type) {
    case 'material':
      return MATERIAL_LABEL[String(v)] ?? String(v);
    case 'materials':
      return Array.isArray(v) ? v.map((m) => MATERIAL_LABEL[String(m)] ?? String(m)).join(', ') : '';
    case 'quantity':
      return `${fmtNumber(String(v))} กก.`;
    case 'price_mode':
    case 'service_mode':
    case 'requested_mode':
      return MODE_LABEL[String(v)] ?? String(v);
    case 'price':
      return `${fmtNumber(String(v))} บาท/${UNIT_LABEL[String(d.price_unit)] ?? ''}`.trim();
    case 'province':
      return provinceLabelTh(v);
    case 'location':
      return 'ระบุแล้ว (ตำแหน่งที่คุณส่ง)';
    case 'ready':
      return v === true ? 'ยังไม่พร้อม' : 'พร้อมแล้ว';
    default:
      return fmtDate(v);
  }
}

function previewOf(view: DraftView): StepPreview {
  const d = view.draft.data as Data;
  const rows = active(STEP_FORMS[view.draft.kind], d)
    .filter((s) => answered(s, d))
    .map((s) => ({ label: s.label, value: valueOf(s, d) }));
  if (d.price_mode === 'NEGOTIABLE') rows.push({ label: 'ราคา', value: 'ต่อรองได้ (ไม่ระบุราคา)' });
  return { kind: view.draft.kind, title: KIND_LABEL_TH[view.draft.kind] ?? view.draft.kind, rows, actions: ACTIONS };
}

function previewReply(view: DraftView, head?: string): StepFormReply {
  const p = previewOf(view);
  const lines = [...(head ? [head] : []), `ตรวจสอบ${p.title}`, ...p.rows.map((r) => `- ${r.label}: ${r.value}`), TEXT.notPublished];
  return {
    text: lines.join('\n'),
    preview: p,
    draft: summarize(view),
    quickReplies: [EDIT, KEEP],
    confirmable: view.complete && view.draft.status === 'AWAITING_REVIEW',
    noWrite: head === undefined,
  };
}

// ---- answer parsing -----------------------------------------------------------------------------
type Parsed = { ok: true; patch: Data } | { ok: false; text: string };
const bad = (text: string): Parsed => ({ ok: false, text });

function pick<T extends string>(text: string, table: readonly Alias<T>[]): T | null {
  const m = matchAliases(text, table);
  return m.length === 1 ? (m[0] as T) : null;
}

function parseAnswer(step: Step, raw: string, data: Data, now: Date): Parsed {
  const text = normalizeText(raw);
  switch (step.type) {
    case 'material': {
      const v = pick(text, MATERIAL_ALIASES);
      return v ? { ok: true, patch: { [step.key]: v } } : bad(T.readChoice);
    }
    case 'materials': {
      const all = /ทุกชนิด|ทั้งหมด/.test(text);
      const v = all ? ['RICE_STRAW', 'CANE_LEAF', 'CORN_COB'] : matchAliases(text, MATERIAL_ALIASES);
      return v.length ? { ok: true, patch: { [step.key]: v } } : bad(T.readChoice);
    }
    case 'price_mode': {
      const v = pick(text, PRICE_MODE_ALIASES);
      return v ? { ok: true, patch: { price_mode: v } } : bad(T.readChoice);
    }
    case 'service_mode': {
      const v = pick(text, SERVICE_MODE_ALIASES);
      return v ? { ok: true, patch: { service_mode: v } } : bad(T.readChoice);
    }
    case 'requested_mode': {
      const v = pick(text, REQUESTED_MODE_ALIASES);
      return v ? { ok: true, patch: { requested_mode: v } } : bad(T.readChoice);
    }
    case 'ready': {
      const v = pick(text, READY_ALIASES);
      return v ? { ok: true, patch: { pending_material: v === 'PENDING' } } : bad(T.readChoice);
    }
    case 'province': {
      const p = parseProvince(text);
      return p.ok ? { ok: true, patch: { province: p.value } } : bad(T.readProvince);
    }
    case 'location':
      return bad(T.needLocation); // answered by a LINE location message or «ข้าม», handled before parsing
    case 'quantity': {
      const q = parseQuantity(text);
      if (q.ok) return { ok: true, patch: { [step.key]: { value: q.value, unit: q.unit } } };
      return bad(q.reason === 'LOCAL_UNIT' ? TEXT.localUnit : q.reason === 'NO_UNIT' ? T.noQtyUnit : T.readQty);
    }
    case 'price': {
      const p = parsePrice(text, step.allowBale === true);
      if (p.ok) return { ok: true, patch: { price: { value: p.value, unit: p.unit } } };
      return bad(p.reason === 'LOCAL_UNIT' ? TEXT.localUnit : p.reason === 'NO_UNIT' ? T.noPriceUnit : T.readPrice);
    }
    case 'date_from':
    case 'date_to':
    case 'date': {
      const r = parseDate(text, now);
      if (!r.ok) {
        return bad(r.reason === 'AMBIGUOUS' || r.reason === 'NO_DATE' ? T.dateAmbiguous : r.reason === 'PAST' ? T.datePast : T.dateInvalid);
      }
      if (step.type === 'date_to' && step.pairedStart && typeof data[step.pairedStart] === 'string') {
        if (r.date < fmtDate(data[step.pairedStart])) return bad(T.dateOrder);
      }
      const iso = step.type === 'date_to' ? endOfBangkokDayIso(r.date) : startOfBangkokDayIso(r.date);
      return { ok: true, patch: { [step.key]: iso } };
    }
  }
}

// ---- the form -----------------------------------------------------------------------------------
export function createStepForm(deps: StepFormDeps): (input: DegradedInput) => Promise<StepFormReply> {
  const clock = deps.clock ?? { now: () => new Date() };

  /** «โหมดถามทีละข้อ» is shown once per conversation: not when this conversation already sent it (last 100 messages). */
  async function noticeIfFirst(actor: Actor, conversationId: string): Promise<string[]> {
    const recent = await deps.conversations.recent(actor, conversationId, 100);
    const shown = recent.ok && recent.value.some((m) => m.direction === 'OUT' && (m.text ?? '').includes(T.notice));
    return shown ? [] : [T.notice];
  }

  async function start(actor: Actor, input: DegradedInput, text: string): Promise<StepFormReply> {
    const allowed = START_KINDS[actor.role];
    if (allowed.length === 0) return { text: TEXT.notAllowed, noWrite: true, confirmable: false };
    const t = normalizeText(text);
    const intent = detectMenuIntent(t);
    const byIntent: DraftKind | undefined = intent === 'SALE' ? 'SALE_LISTING' : intent === 'BALING_REQUEST' ? 'BALING_REQUEST' : undefined;
    const chosen =
      allowed.find((k) => t === KIND_LABEL_TH[k]) ??
      (byIntent && allowed.includes(byIntent) ? byIntent : undefined) ??
      (allowed.length === 1 ? allowed[0] : undefined);
    const notice = await noticeIfFirst(actor, input.conversation.id);
    if (!chosen) {
      return {
        text: [...notice, T.chooseKind].join('\n'), noWrite: true, confirmable: false,
        quickReplies: actor.role === 'FARMER' ? [...FARMER_MAIN_MENU] : allowed.map((k) => KIND_LABEL_TH[k] ?? k),
      };
    }
    const created = await deps.drafts.create(actor, { kind: chosen });
    if (!created.ok) return { text: created.error.code === 'FORBIDDEN' ? TEXT.notAllowed : TEXT.rejectedFields, noWrite: true, confirmable: false };
    await deps.conversations.setActiveDraft(actor, input.conversation.id, created.value.draft.id);
    const first = firstMissing(chosen, created.value.draft.data as Data);
    const head = [...notice, `เริ่มกรอก${KIND_LABEL_TH[chosen] ?? ''} (ร่างยังไม่เผยแพร่)`].join('\n');
    return first
      ? { ...ask(first, head), draft: summarize(created.value), noWrite: false }
      : previewReply(created.value, head);
  }

  async function handle(input: DegradedInput): Promise<StepFormReply> {
    const actor: Actor = { ...input.actor, channel: 'assistant' };
    const text = normalizeText(input.text);

    let current: DraftView | null = null;
    if (input.conversation.active_draft_id) {
      const g = await deps.drafts.get(actor, input.conversation.active_draft_id);
      if (g.ok && (g.value.draft.status === 'DRAFT' || g.value.draft.status === 'AWAITING_REVIEW')) current = g.value;
    }
    if (!current) return start(actor, input, text);

    const kind = current.draft.kind;
    const data = current.draft.data as Data;
    const recent = await deps.conversations.recent(input.actor, input.conversation.id, 4);
    const lastOut = recent.ok ? [...recent.value].reverse().find((m) => m.direction === 'OUT') : undefined;

    // «ลงขายวัสดุ» and similar while a draft is open: continue that draft, never start a second one.
    const intent = detectMenuIntent(text);
    if (intent === 'SALE' || intent === 'BALING_REQUEST') {
      const pending = pendingStep(kind, lastOut);
      const target = pending && (!pending.when || pending.when(data)) ? pending : firstMissing(kind, data);
      return target ? ask(target, T.resume) : previewReply(current, T.resume);
    }

    // Buttons the human presses; typing them never publishes.
    if (text === KEEP) return { text: T.keep, noWrite: true, confirmable: false, draft: summarize(current) };
    if (text === CONFIRM) {
      return current.complete ? { ...previewReply(current, T.pressButton), noWrite: true } : { ...ask(firstMissing(kind, data) as Step, T.pressButton) };
    }
    const editable = active(STEP_FORMS[kind], data);
    if (text === EDIT) {
      return {
        text: T.editMenu, noWrite: true, confirmable: false, draft: summarize(current),
        quickReplies: editable.map((s) => s.label).slice(0, 13),
      };
    }
    if (lastOut?.text === T.editMenu) {
      const chosen = editable.find((s) => s.label === text);
      if (chosen) return ask(chosen);
    }

    const step = pendingStep(kind, lastOut);
    const target = step && (!step.when || step.when(data)) ? step : firstMissing(kind, data);
    if (!target) return previewReply(current);

    // Location question: a LINE location message (the channel stores the coordinates, then sends LOCATION_SHARED_TEXT)
    // or «ข้าม» moves on. Anything else asks again. Nothing is written here.
    if (target.type === 'location') {
      if (text !== SKIP && text !== LOCATION_SHARED_TEXT) return ask(target, T.needLocation);
      const next = firstMissing(kind, data);
      return next ? ask(next) : previewReply(current);
    }

    const parsed = parseAnswer(target, text, data, clock.now());
    if (!parsed.ok) return ask(target, parsed.text.includes(T.noWrite) ? parsed.text : `${parsed.text} ${T.noWrite}`);

    const w = await deps.drafts.patch(actor, { draftId: current.draft.id, expectedVersion: current.draft.version, patch: parsed.patch });
    if (!w.ok) {
      switch (w.error.code) {
        case 'FORBIDDEN':
        case 'NOT_FOUND':
          return { text: TEXT.notAllowed, noWrite: true, confirmable: false };
        case 'STALE_VERSION':
          return ask(target, TEXT.stale);
        case 'VALIDATION': {
          const fields = w.error.fields ?? [];
          const msg = fields.some((f) => f.message === 'UNIT_NEEDS_CONFIRMATION')
            ? TEXT.localUnit
            : fields.some((f) => f.message === 'BEFORE_START')
              ? `${T.dateOrder} ${T.noWrite}`
              : `${TEXT.rejectedFields}`;
          return ask(target, msg);
        }
        default:
          return ask(target, TEXT.rejectedFields);
      }
    }
    const view = w.value;
    const vdata = view.draft.data as Data;
    // Right after the province: offer the optional location question once.
    const locationDef = active(STEP_FORMS[kind], vdata).find((s) => s.type === 'location');
    if (target.type === 'province' && locationDef && vdata.lat === undefined) {
      return { ...ask(locationDef, T.saved), noWrite: false, draft: summarize(view) };
    }
    const next = firstMissing(kind, vdata);
    if (next && !view.complete) return { ...ask(next, T.saved), noWrite: false, draft: summarize(view) };
    return { ...previewReply(view, T.saved), noWrite: false };
  }

  return handle;
}
