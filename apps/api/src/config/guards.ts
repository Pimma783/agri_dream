import type { Env } from './env.js';

export const ALLOWED_REGIONS = ['ap-southeast-1', 'ap-southeast-7', 'us-east-1'] as const;
export const FORBIDDEN_MODEL_PREFIXES = ['global.', 'apac.'] as const;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

/** True iff the model ID routes to other Regions (refused by the team account). */
export function isForbiddenModelId(modelId: string): boolean {
  return FORBIDDEN_MODEL_PREFIXES.some((p) => modelId.startsWith(p));
}

/** Returns every guard violation; empty means the config is acceptable. */
export function checkGuards(env: Env): string[] {
  const problems: string[] = [];

  for (const name of ['BEDROCK_MODEL_ID', 'BEDROCK_VISION_MODEL_ID'] as const) {
    if (isForbiddenModelId(env[name])) {
      problems.push(
        `${name}="${env[name]}" is refused: IDs starting with ${FORBIDDEN_MODEL_PREFIXES.join(' or ')} route to other Regions`,
      );
    }
  }

  if (!(ALLOWED_REGIONS as readonly string[]).includes(env.AWS_REGION)) {
    problems.push(
      `AWS_REGION="${env.AWS_REGION}" is outside the allow-list (${ALLOWED_REGIONS.join(', ')})`,
    );
  }

  if (env.NODE_ENV === 'production') {
    const mocks: Array<[string, boolean]> = [
      ['ENABLE_REAL_LINE', env.ENABLE_REAL_LINE],
      ['ENABLE_REAL_BEDROCK', env.ENABLE_REAL_BEDROCK],
    ];
    for (const [name, on] of mocks) {
      if (!on) problems.push(`${name}=false would use a mock adapter, which is refused when NODE_ENV=production`);
    }
  }

  return problems;
}
