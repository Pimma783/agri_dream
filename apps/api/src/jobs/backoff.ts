export interface BackoffPolicy {
  baseMs: number;
  capMs: number;
}
export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 2_000, capMs: 15 * 60_000 };

/**
 * Delay before the next try, after `attempts` tries have been used (attempts >= 1).
 * Exponential with "equal jitter": half the exponential step is fixed, half is random,
 * so the result is in [step/2, step] and step = min(cap, base * 2^(attempts-1)).
 * `random` returns a number in [0, 1) and is injected so tests are deterministic.
 */
export function backoffDelayMs(attempts: number, policy: BackoffPolicy, random: () => number): number {
  const n = Math.max(1, Math.floor(attempts));
  const step = Math.min(policy.capMs, policy.baseMs * 2 ** Math.min(n - 1, 40));
  return Math.floor(step / 2 + random() * (step / 2));
}
