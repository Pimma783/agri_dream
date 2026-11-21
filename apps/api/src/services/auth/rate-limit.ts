export interface LoginRateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  /** Hard cap on tracked keys so an attacker cannot grow memory without bound. */
  maxKeys?: number;
}
interface Entry {
  failures: number;
  windowStart: number;
}
/**
 * In-memory failed-login limiter keyed by IP + email. Single instance only: state is lost on restart
 * and not shared between processes (design.md, "Auth, sessions, CSRF").
 */
export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maxKeys: number;
  constructor(private readonly opts: LoginRateLimiterOptions) {
    this.maxKeys = opts.maxKeys ?? 10_000;
  }
  static key(ip: string, email: string): string {
    return `${ip}|${email.trim().toLowerCase()}`;
  }
  /** Seconds until the key may try again, or 0 when it is allowed now. */
  retryAfterSeconds(key: string, now: number): number {
    const e = this.live(key, now);
    if (!e || e.failures < this.opts.maxAttempts) return 0;
    return Math.max(1, Math.ceil((e.windowStart + this.opts.windowMs - now) / 1000));
  }
  recordFailure(key: string, now: number): void {
    const e = this.live(key, now);
    if (e) {
      e.failures += 1;
      return;
    }
    if (this.entries.size >= this.maxKeys) this.prune(now);
    if (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { failures: 1, windowStart: now });
  }
  reset(key: string): void {
    this.entries.delete(key);
  }
  get size(): number {
    return this.entries.size;
  }
  private live(key: string, now: number): Entry | undefined {
    const e = this.entries.get(key);
    if (e && now - e.windowStart >= this.opts.windowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }
  private prune(now: number): void {
    for (const [k, e] of this.entries) if (now - e.windowStart >= this.opts.windowMs) this.entries.delete(k);
  }
}
