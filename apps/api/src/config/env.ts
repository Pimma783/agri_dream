import { z } from 'zod';

/** Strict boolean env: only "true" or "false"; absent uses the default. */
const flag = (def: boolean) =>
  z
    .enum(['true', 'false'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true');

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Real integrations stay off until the user supplies credentials and verifies them.
  ENABLE_REAL_LINE: flag(false),
  ENABLE_REAL_BEDROCK: flag(false),
  /** @deprecated Unused. Images are stored in PostgreSQL (storage_kind 'db'); 's3' is reserved. Accepted so old .env files still load. */
  ENABLE_REAL_S3: flag(false),
  VISION_ENABLED: flag(false),
  /** Assistant model use. Absent: 'enabled' only when ENABLE_REAL_BEDROCK=true, otherwise 'disabled' (see resolveAiMode). */
  AI_MODE: z.enum(['enabled', 'disabled']).optional(),

  AWS_REGION: z.string().min(1).default('ap-southeast-1'),
  BEDROCK_MODEL_ID: z.string().min(1).default('anthropic.claude-sonnet-5'),
  BEDROCK_VISION_MODEL_ID: z.string().min(1).default('anthropic.claude-sonnet-5'),
  /** Assistant: how many recent messages go to the model (design A11). */
  ASSISTANT_HISTORY_MESSAGES: z.coerce.number().int().min(1).max(50).default(12),

  /** @deprecated Unused. There is no local-filesystem media store. Accepted for backward compatibility. */
  LOCAL_MEDIA_DIR: z.string().default('./var/media'),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
  // Sessions and login throttling (Requirement 3.5). Idle expiry slides; absolute expiry does not.
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(60 * 24 * 30).default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24),
  LOGIN_RATE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(1000).default(5),
  LOGIN_RATE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86400).default(900),
  // LINE link codes (Requirement 3.1): short-lived, single use.
  LINK_CODE_TTL_MINUTES: z.coerce.number().int().min(1).max(60 * 24).default(10),
  // Default offer lifetime when the sender gives no expiry (Requirement 11.7, A11).
  OFFER_EXPIRY_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(72),
  SESSION_SECRET: z.string().min(1).optional(),
  // One LINE Official Account per role. Secrets are separate, so a signature for one role never validates on another.
  LINE_FARMER_CHANNEL_SECRET: z.string().min(1).optional(),
  LINE_FARMER_ACCESS_TOKEN: z.string().min(1).optional(),
  LINE_BALER_CHANNEL_SECRET: z.string().min(1).optional(),
  LINE_BALER_ACCESS_TOKEN: z.string().min(1).optional(),
  LINE_FACTORY_CHANNEL_SECRET: z.string().min(1).optional(),
  LINE_FACTORY_ACCESS_TOKEN: z.string().min(1).optional(),
  // Public Basic IDs of the Official Accounts (for example "@abc1234"). Shown to members so they know where to send a link code.
  LINE_FARMER_BASIC_ID: z.string().regex(/^@?[A-Za-z0-9._-]{1,40}$/).optional(),
  LINE_BALER_BASIC_ID: z.string().regex(/^@?[A-Za-z0-9._-]{1,40}$/).optional(),
  LINE_FACTORY_BASIC_ID: z.string().regex(/^@?[A-Za-z0-9._-]{1,40}$/).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** AI_MODE with its default: enabled only if real Bedrock is on. */
export function resolveAiMode(env: Pick<Env, 'AI_MODE' | 'ENABLE_REAL_BEDROCK'>): 'enabled' | 'disabled' {
  return env.AI_MODE ?? (env.ENABLE_REAL_BEDROCK ? 'enabled' : 'disabled');
}
