import type { Env } from '../config/env.js';

export type AdapterKind = 'real' | 'mock';

export interface AdapterKinds {
  line: AdapterKind;
  bedrock: AdapterKind;
  media: AdapterKind;
}

/**
 * Reports which adapter family is selected by configuration.
 * 'real' only means the flag is on; it never means the integration was verified.
 * Replaced by the adapters' own `kind` fields once the adapters exist.
 */
export function adapterKinds(env: Env): AdapterKinds {
  return {
    line: env.ENABLE_REAL_LINE ? 'real' : 'mock',
    bedrock: env.ENABLE_REAL_BEDROCK ? 'real' : 'mock',
    // Media is stored in PostgreSQL (DbMediaStore), which is a real store. ENABLE_REAL_S3 is unused.
    media: 'real',
  };
}
