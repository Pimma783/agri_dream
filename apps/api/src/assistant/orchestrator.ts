// Assistant orchestrator (task 10.2, Requirements 4 and 5). One user message in, one reply out.
// Authority: the model only proposes. Output must pass AssistantTurnSchema (strict, whitelisted), the unit and
// BALER checks in tools.ts, and the draft service's own permission and version checks. The model cannot publish,
// send, accept, confirm or cancel: no such tool exists. Order of work per turn:
//   1. store the user message (dedupe by source event id)  2. AI disabled -> degraded hook (task 10.5)
//   3. load context for this actor only  4. converse, parse, validate, one repair retry  5. run exactly one tool
//   6. store the reply.
import type { BedrockPort, ConverseRequest } from '../adapters/bedrock/port.js';
import type { Actor } from '../domain/permissions.js';
import { appError, err, ok, type ConversationService, type DraftService, type DraftView, type Result } from '../services/index.js';
import type { Conversation } from '../services/index.js';
import { ASSISTANT_SYSTEM, TEXT, buildRepairNotice, buildUserContent } from './prompts.js';
import { AssistantTurnSchema, type AssistantTurn, type DraftKind, parseModelJson } from './schemas.js';
import {
  type DraftSummary, type MatchExplainPort, type ToolContext, type ToolDeps, type ToolName, type ToolOutcome,
  answerGeneral, askUser, explainMatches, findUnsupportedUnit, isOpenDraft, patchDraft, selectTool, showStatus,
} from './tools.js';

export type DegradedReason = 'AI_DISABLED' | 'MODEL_UNAVAILABLE';

/** Structured summary the channel renders for the human review step (task 10.5). Publishing is a button, never text. */
export interface StepPreview {
  kind: DraftKind;
  title: string;
  rows: Array<{ label: string; value: string }>;
  /** Buttons for the channel: «ยืนยันเผยแพร่» (postback with draft id and version), «แก้ไข», «เก็บร่าง». */
  actions: Array<{ id: 'CONFIRM_PUBLISH' | 'EDIT' | 'KEEP_DRAFT'; label: string }>;
}

export interface AssistantReply {
  text: string;
  tool: ToolName | 'degraded';
  quickReplies?: string[];
  draft?: DraftSummary;
  /** The channel may render the human confirm button. Publishing is never done here. */
  confirmable: boolean;
  /** Set by the degraded step form when a draft is complete and ready for human review. */
  preview?: StepPreview;
  /** The channel should add a LINE «send location» quick-reply button (step form location question). */
  requestLocation?: boolean;
  /** True when the reply came from the degraded path, not the model. */
  degraded: boolean;
  /** True when this turn wrote nothing to a draft. */
  noWrite: boolean;
}

export interface DegradedInput {
  actor: Actor;
  conversation: Conversation;
  text: string;
  reason: DegradedReason;
}

export interface AssistantDeps {
  bedrock: BedrockPort;
  modelId: string;
  drafts: DraftService;
  conversations: ConversationService;
  /** Backend match source for explain_matches. Without it the reply says there is no data. */
  matches?: MatchExplainPort;
  /** History window (ASSISTANT_HISTORY_MESSAGES). Default 12. */
  historyWindow?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** When false the model is never called. Evaluated per turn. Default true. */
  aiEnabled?: () => boolean;
  /** Step-form mode (createStepForm in step-form.ts). Called when AI is disabled or Bedrock fails after its own retries. */
  degraded?: (input: DegradedInput) => Promise<Pick<AssistantReply, 'text'> & Partial<AssistantReply>>;
}

export interface UserMessage {
  text: string;
  /** LINE event id or similar, so a redelivered message is not processed twice. */
  sourceEventId?: string;
  /** Text read out of an image by another component. Treated as data only. */
  imageText?: readonly string[];
}

export interface Assistant {
  handle(actor: Actor, message: UserMessage): Promise<Result<AssistantReply | null>>;
}

export const DEFAULT_HISTORY_WINDOW = 12;
const MAX_INPUT_CHARS = 2000;

const reply = (o: ToolOutcome): AssistantReply => ({
  text: o.text,
  tool: o.tool,
  ...(o.quickReplies ? { quickReplies: o.quickReplies } : {}),
  ...(o.draft ? { draft: o.draft } : {}),
  confirmable: o.confirmable === true,
  degraded: false,
  noWrite: o.noWrite === true,
});

export function createAssistant(deps: AssistantDeps): Assistant {
  const window = Math.max(1, deps.historyWindow ?? DEFAULT_HISTORY_WINDOW);
  const toolDeps: ToolDeps = { drafts: deps.drafts, conversations: deps.conversations, ...(deps.matches ? { matches: deps.matches } : {}) };

  async function degraded(input: DegradedInput): Promise<AssistantReply> {
    // Step-form mode (step-form.ts) is injected as `deps.degraded`; without it the fixed Thai notice is used.
    const r = deps.degraded ? await deps.degraded(input) : null;
    return {
      tool: 'degraded', confirmable: false, noWrite: true, ...(r ?? { text: TEXT.aiUnavailable }), degraded: true,
    } as AssistantReply;
  }

  /** Call the model; parse and validate; one repair retry carrying only the validation error text. */
  async function askModel(userBlock: string): Promise<
    | { kind: 'turn'; turn: AssistantTurn }
    | { kind: 'unit'; unit: string }
    | { kind: 'invalid' }
    | { kind: 'unavailable' }
  > {
    const build = (repair?: string): ConverseRequest => ({
      modelId: deps.modelId,
      system: ASSISTANT_SYSTEM,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: userBlock }, ...(repair ? [{ type: 'text' as const, text: repair }] : [])],
      }],
      maxTokens: deps.maxTokens ?? 1024,
    });
    let repair: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const r = await deps.bedrock.converse(build(repair), AbortSignal.timeout(deps.timeoutMs ?? 20_000));
      if (!r.ok) return { kind: 'unavailable' };
      const raw = parseModelJson(r.text);
      // เกวียน / ไร่ / bales: ask the user instead of spending the repair retry.
      const unit = findUnsupportedUnit(raw);
      if (unit !== null) return { kind: 'unit', unit };
      const parsed = AssistantTurnSchema.safeParse(raw);
      if (parsed.success) return { kind: 'turn', turn: parsed.data };
      repair = buildRepairNotice(raw === null ? [{ path: [], code: 'invalid_type' }] : parsed.error.issues);
    }
    return { kind: 'invalid' };
  }

  async function handle(actor: Actor, message: UserMessage): Promise<Result<AssistantReply | null>> {
    const text = (message.text ?? '').trim().slice(0, MAX_INPUT_CHARS);
    if (!text) return err(appError('VALIDATION', { fields: [{ path: 'text', message: 'REQUIRED' }] }));
    // Drafts are always written as the assistant channel (draft service refuses publish and cancel for it).
    const assistantActor: Actor = { ...actor, channel: 'assistant' };

    const opened = await deps.conversations.open(actor);
    if (!opened.ok) return opened;
    const conversation = opened.value;

    const stored = await deps.conversations.append(actor, {
      conversationId: conversation.id, direction: 'IN', text,
      ...(message.sourceEventId ? { sourceEventId: message.sourceEventId } : {}),
    });
    if (!stored.ok) return stored;
    if (stored.value === null) return ok(null); // duplicate delivery: already handled

    const finish = async (r: AssistantReply): Promise<Result<AssistantReply>> => {
      const out = await deps.conversations.append(actor, { conversationId: conversation.id, direction: 'OUT', text: r.text });
      return out.ok ? ok(r) : out;
    };

    if (deps.aiEnabled && !deps.aiEnabled()) {
      return finish(await degraded({ actor, conversation, text, reason: 'AI_DISABLED' }));
    }

    // Context for this actor only. A draft of another organization reads as NOT_FOUND and is dropped.
    let activeDraft: DraftView | null = null;
    if (conversation.active_draft_id) {
      const d = await deps.drafts.get(assistantActor, conversation.active_draft_id);
      if (d.ok && isOpenDraft(d.value)) activeDraft = d.value;
    }
    const recent = await deps.conversations.recent(actor, conversation.id, window);
    if (!recent.ok) return recent;
    // The window includes the message just stored; it is sent separately as the current message.
    const history = recent.value.slice(0, -1);

    const userBlock = buildUserContent({
      role: actor.role,
      activeDraft: activeDraft
        ? { kind: activeDraft.draft.kind, status: activeDraft.draft.status, data: activeDraft.draft.data, missing_fields: activeDraft.missing_fields }
        : null,
      history: history.map((m) => ({ direction: m.direction, text: m.text ?? '' })),
      current: text,
      ...(message.imageText ? { imageText: message.imageText } : {}),
    });

    const m = await askModel(userBlock);
    if (m.kind === 'unavailable') return finish(await degraded({ actor, conversation, text, reason: 'MODEL_UNAVAILABLE' }));
    if (m.kind === 'unit') return finish(reply({ tool: 'ask_user', text: TEXT.unit(m.unit), noWrite: true }));
    // Fail closed: nothing was written, the user gets a clarifying question.
    if (m.kind === 'invalid') return finish(reply({ tool: 'ask_user', text: TEXT.failClosed, noWrite: true }));

    const ctx: ToolContext = { actor: assistantActor, conversation, activeDraft, userText: text, history };
    const tool = selectTool(m.turn);
    let outcome: ToolOutcome;
    switch (tool) {
      case 'patch_draft':
        outcome = await patchDraft(toolDeps, ctx, m.turn);
        break;
      case 'explain_matches':
        outcome = await explainMatches(toolDeps, ctx);
        break;
      case 'show_status':
        outcome = await showStatus(toolDeps, ctx);
        break;
      case 'answer_general':
        outcome = answerGeneral(m.turn);
        break;
      case 'ask_user':
        outcome = askUser(m.turn);
        break;
    }
    return finish(reply(outcome));
  }

  return { handle };
}
