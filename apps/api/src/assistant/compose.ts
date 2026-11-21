// Single composition point for the assistant. LINE channel handlers and the Dashboard assistant page
// import `composeAssistant` instead of wiring createAssistant themselves.
import { selectBedrockAdapter } from '../adapters/bedrock/select.js';
import type { BedrockPort } from '../adapters/bedrock/port.js';
import { resolveAiMode, type Env } from '../config/env.js';
import type { ConversationService, DraftService } from '../services/index.js';
import type { MatchReadService } from '../services/matches/index.js';
import { createMatchExplainPort } from './match-explain.js';
import { createAssistant, type Assistant } from './orchestrator.js';
import { createStepForm, type StepFormClock } from './step-form.js';

export type AssistantEnv = Pick<Env, 'ENABLE_REAL_BEDROCK' | 'BEDROCK_MODEL_ID' | 'ASSISTANT_HISTORY_MESSAGES'> &
  Partial<Pick<Env, 'AWS_REGION' | 'AI_MODE'>>;

export interface ComposeAssistantDeps {
  env: AssistantEnv;
  drafts: DraftService;
  conversations: ConversationService;
  matches: MatchReadService;
  /** Tests pass a scripted port. Production leaves it unset. */
  bedrock?: BedrockPort;
  clock?: StepFormClock;
}

export function composeAssistant(deps: ComposeAssistantDeps): Assistant {
  const { env } = deps;
  return createAssistant({
    bedrock: selectBedrockAdapter(env, deps.bedrock),
    modelId: env.BEDROCK_MODEL_ID,
    drafts: deps.drafts,
    conversations: deps.conversations,
    matches: createMatchExplainPort(deps.matches),
    historyWindow: env.ASSISTANT_HISTORY_MESSAGES,
    aiEnabled: () => resolveAiMode(env) === 'enabled',
    degraded: createStepForm({ drafts: deps.drafts, conversations: deps.conversations, ...(deps.clock ? { clock: deps.clock } : {}) }),
  });
}
