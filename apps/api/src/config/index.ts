import { EnvSchema, type Env } from './env.js';
import { checkGuards, ConfigError } from './guards.js';

/** Parse raw env, then apply startup guards. Throws ConfigError naming each offending value. */
export function loadConfig(raw: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const problems = checkGuards(parsed.data);
  if (problems.length > 0) throw new ConfigError(problems);
  return parsed.data;
}

export { EnvSchema, type Env } from './env.js';
export { checkGuards, ConfigError, isForbiddenModelId, ALLOWED_REGIONS } from './guards.js';
export { lineChannelConfigs, LINE_CHANNEL_KEYS, type LineChannelConfig, type LineChannelKey } from './line.js';
