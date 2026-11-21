// Closed, draft-only tool set (design.md "Assistant"). There is no publish, send-offer, accept, confirm or cancel tool:
// those exist only as buttons the backend renders, executed by services with the human's actor (Requirement 5.1).
// Tools call services, never repos. The model's text is advisory; numbers and statuses are rendered here.
import type { Actor } from '../domain/permissions.js';
import { renderFlagTh, renderReasonsTh, WEIGHTS_DISCLAIMER_TH } from '../matching/index.js';
import type { Flag, Reason } from '../matching/types.js';
import type { Conversation, ConversationService, DraftService, DraftView, Message, Result } from '../services/index.js';
import { KIND_LABEL_TH, labelOfField, TEXT } from './prompts.js';
import type { AssistantTurn, DraftKind } from './schemas.js';

export const TOOL_NAMES = ['patch_draft', 'ask_user', 'explain_matches', 'show_status', 'answer_general'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Read-only match source (task 7.3 supplies the real one). Items carry the backend's `reasons[]`. */
export interface MatchExplainItem {
  id: string;
  title?: string;
  tier: 0 | 1;
  reasons: readonly Reason[];
  flags: readonly Flag[];
}
export interface MatchExplainPort {
  listForActor(actor: Actor, limit: number): Promise<Result<MatchExplainItem[]>>;
}

export interface DraftSummary {
  id: string;
  kind: DraftKind;
  version: number;
  status: string;
  complete: boolean;
  missing_fields: string[];
}

export interface ToolOutcome {
  tool: ToolName;
  text: string;
  quickReplies?: string[];
  draft?: DraftSummary;
  /** True when the draft is complete and the channel may render the human "confirm" button. */
  confirmable?: boolean;
  /** Set when the write was refused or fell back to a question, so nothing was saved. */
  noWrite?: boolean;
}

export interface ToolDeps {
  drafts: DraftService;
  conversations: ConversationService;
  matches?: MatchExplainPort;
}

export interface ToolContext {
  /** Actor with channel 'assistant': used for every draft service call. */
  actor: Actor;
  conversation: Conversation;
  /** Open draft of the actor's own org that the conversation points at, if any. */
  activeDraft: DraftView | null;
  /** Current user message and the stored history before it (oldest first). */
  userText: string;
  history: readonly Message[];
}

const OPEN = new Set(['DRAFT', 'AWAITING_REVIEW']);
export const isOpenDraft = (d: DraftView | null): d is DraftView => d !== null && OPEN.has(d.draft.status);

export const summarize = (v: DraftView): DraftSummary => ({
  id: v.draft.id,
  kind: v.draft.kind,
  version: v.draft.version,
  status: v.draft.status,
  complete: v.complete,
  missing_fields: v.missing_fields,
});

/** The only mapping from a validated model turn to a tool. */
export function selectTool(turn: AssistantTurn): ToolName {
  if (turn.draft_patch) return 'patch_draft';
  switch (turn.intent) {
    case 'FIND_BALER':
      return 'explain_matches';
    case 'CHECK_STATUS':
      return 'show_status';
    case 'GENERAL':
      return 'answer_general';
    default:
      return 'ask_user';
  }
}

// ---- local units (Requirement 6.9) --------------------------------------------------------------
const LOCAL_UNIT = /เกวียน|ไร่|งาน|วา|มัด|ก้อน|bale|rai|kwian/i;
const METRIC_UNIT = /กก\.?|กิโล|ตัน|\bkg\b|\bkgs\b|\bton(s|ne|nes)?\b/i;
const QUANTITY_FIELDS = ['quantity', 'target_quantity', 'min_lot', 'min_quantity', 'capacity', 'price', 'max_price'] as const;

/** Unit string of the first quantity or price in the raw (unvalidated) model output that is not kg or ton. */
export function findUnsupportedUnit(raw: unknown): string | null {
  const fields = (raw as { draft_patch?: { fields?: unknown } } | null)?.draft_patch?.fields;
  if (fields === null || typeof fields !== 'object') return null;
  for (const key of QUANTITY_FIELDS) {
    const v = (fields as Record<string, unknown>)[key] as { unit?: unknown } | undefined;
    if (v && typeof v === 'object' && typeof v.unit === 'string' && v.unit !== 'kg' && v.unit !== 'ton') return v.unit;
  }
  return null;
}

/** The user wrote a local unit and no kg or ton, so any number the model produced is a guess. */
export const userUsedOnlyLocalUnits = (text: string): boolean => LOCAL_UNIT.test(text) && !METRIC_UNIT.test(text);

// ---- BALER intent (Requirement 4.7) -------------------------------------------------------------
const BUY = /รับซื้อ|ต้องการซื้อ|อยากซื้อ|ซื้อฟาง|ซื้อวัตถุดิบ|\bbuy\b/i;
const SERVE = /ให้บริการ|รับอัด|รับจ้างอัด|บริการอัด|อัดฟาง|baling service/i;
const AMBIGUOUS_KINDS = new Set<DraftKind>(['PURCHASE_DEMAND', 'BALING_SERVICE']);

/** One message's signal: a kind, or null when absent or when it names both. */
function signalOf(text: string, afterQuestion: boolean): DraftKind | null {
  const buy = BUY.test(text);
  const serve = SERVE.test(text);
  if (buy !== serve) return buy ? 'PURCHASE_DEMAND' : 'BALING_SERVICE';
  if (!buy && !serve && afterQuestion) {
    const t = text.trim();
    if (t === '1') return 'PURCHASE_DEMAND';
    if (t === '2') return 'BALING_SERVICE';
  }
  return null;
}

/** Latest clear answer among the user's messages (newest first), including a "1"/"2" reply to our question. */
export function resolveBalerIntent(history: readonly Message[], current: string): DraftKind | null {
  const seq: Array<{ dir: 'IN' | 'OUT'; text: string }> = [
    ...history.map((m) => ({ dir: m.direction, text: m.text ?? '' })),
    { dir: 'IN', text: current },
  ];
  for (let i = seq.length - 1; i >= 0; i -= 1) {
    const m = seq[i];
    if (!m || m.dir !== 'IN') continue;
    const prev = seq[i - 1];
    const s = signalOf(m.text, prev?.dir === 'OUT' && prev.text === TEXT.balerAmbiguity);
    if (s) return s;
  }
  return null;
}

// ---- tools --------------------------------------------------------------------------------------
const ask = (text: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ tool: 'ask_user', text, noWrite: true, ...extra });

/** Assistant field names -> the draft service's patch keys (services/drafts/schemas PATCH_SCHEMAS). */
function toServicePatch(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (k === 'max_price') out.price = v;
    else if (k === 'radius_km') out.radius_km = String(v);
    else out[k] = v;
  }
  return out;
}

export async function patchDraft(deps: ToolDeps, ctx: ToolContext, turn: AssistantTurn): Promise<ToolOutcome> {
  const dp = turn.draft_patch;
  if (!dp) return ask(TEXT.emptyPatch);
  const fields = toServicePatch(dp.fields as Record<string, unknown>);
  if (Object.keys(fields).length === 0) return ask(turn.questions?.[0] ?? turn.reply_text ?? TEXT.emptyPatch);

  // The user gave a local unit and no kg/ton: the model's number would be a guess. Ask, write nothing.
  if (userUsedOnlyLocalUnits(ctx.userText) && QUANTITY_FIELDS.some((k) => k in fields)) {
    return ask(TEXT.localUnit);
  }

  const existing = isOpenDraft(ctx.activeDraft) && ctx.activeDraft.draft.kind === dp.kind ? ctx.activeDraft : null;

  // A baler's intent must be resolved before any draft of an ambiguous kind is created.
  if (!existing && ctx.actor.role === 'BALER' && AMBIGUOUS_KINDS.has(dp.kind)) {
    if (resolveBalerIntent(ctx.history, ctx.userText) !== dp.kind) {
      return ask(TEXT.balerAmbiguity, { quickReplies: ['รับซื้อวัตถุดิบ', 'ให้บริการอัดฟาง'] });
    }
  }

  let result: Result<DraftView>;
  if (existing) {
    result = await deps.drafts.patch(ctx.actor, { draftId: existing.draft.id, expectedVersion: existing.draft.version, patch: fields });
  } else {
    result = await deps.drafts.create(ctx.actor, { kind: dp.kind, patch: fields });
    if (result.ok) await deps.conversations.setActiveDraft(ctx.actor, ctx.conversation.id, result.value.draft.id);
  }
  if (!result.ok) {
    switch (result.error.code) {
      case 'FORBIDDEN':
      case 'NOT_FOUND':
        return ask(TEXT.notAllowed);
      case 'STALE_VERSION':
        return ask(TEXT.stale);
      case 'VALIDATION': {
        const bad = (result.error.fields ?? []).map((f) => labelOfField(f.path.split('.')[0] ?? f.path));
        const unit = (result.error.fields ?? []).some((f) => f.message === 'UNIT_NEEDS_CONFIRMATION');
        return ask(unit ? TEXT.localUnit : `${TEXT.rejectedFields}${bad.length ? `: ${[...new Set(bad)].join(', ')}` : ''}`);
      }
      default:
        return ask(TEXT.rejectedFields);
    }
  }
  const view = result.value;
  const lines = [`บันทึกร่าง${KIND_LABEL_TH[view.draft.kind] ?? ''}แล้ว (${TEXT.notPublished})`];
  if (view.complete) lines.push(TEXT.complete);
  else lines.push(`ข้อมูลที่ยังขาดหรือยังไม่ถูกต้อง: ${[...new Set(view.missing_fields.map(labelOfField))].join(', ')}`);
  if (!view.complete && turn.questions?.length) lines.push(...turn.questions);
  return {
    tool: 'patch_draft',
    text: lines.join('\n'),
    draft: summarize(view),
    confirmable: view.complete && view.draft.status === 'AWAITING_REVIEW',
  };
}

export function askUser(turn: AssistantTurn): ToolOutcome {
  const parts = [turn.reply_text, ...(turn.questions ?? [])].filter((s) => s.trim().length > 0);
  return ask(parts.length ? parts.join('\n') : TEXT.failClosed);
}

export function answerGeneral(turn: AssistantTurn): ToolOutcome {
  return { tool: 'answer_general', text: turn.reply_text.trim() || TEXT.failClosed, noWrite: true };
}

/** Match cards are rendered from the backend's `reasons[]`; the model's wording is not used. */
export async function explainMatches(deps: ToolDeps, ctx: ToolContext): Promise<ToolOutcome> {
  const r = deps.matches ? await deps.matches.listForActor(ctx.actor, 3) : null;
  if (!r || !r.ok || r.value.length === 0) return { tool: 'explain_matches', text: TEXT.noMatches, noWrite: true };
  const blocks = r.value.map((m, i) => {
    const lines = [`${i + 1}. ${m.title ?? 'คู่ที่เหมาะสม'}`, ...renderReasonsTh(m.reasons).map((t) => `- ${t}`)];
    for (const f of m.flags) lines.push(`- ${renderFlagTh(f)}`);
    return lines.join('\n');
  });
  return { tool: 'explain_matches', text: [...blocks, WEIGHTS_DISCLAIMER_TH].join('\n\n'), noWrite: true };
}

const STATUS_TH: Readonly<Record<string, string>> = {
  DRAFT: 'ร่าง (ข้อมูลยังไม่ครบ)',
  AWAITING_REVIEW: 'รอยืนยัน',
  PUBLISHED: 'เผยแพร่แล้ว',
  CANCELLED: 'ยกเลิกแล้ว',
};

export async function showStatus(deps: ToolDeps, ctx: ToolContext): Promise<ToolOutcome> {
  const r = await deps.drafts.list(ctx.actor);
  if (!r.ok || r.value.length === 0) return { tool: 'show_status', text: TEXT.noDrafts, noWrite: true };
  const lines = r.value.slice(0, 5).map((v) => `- ${KIND_LABEL_TH[v.draft.kind] ?? v.draft.kind}: ${STATUS_TH[v.draft.status] ?? v.draft.status}`);
  return { tool: 'show_status', text: ['รายการของคุณ', ...lines].join('\n'), noWrite: true };
}
