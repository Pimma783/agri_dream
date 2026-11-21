import { type JobsClock, type JobsLogger, silentLogger, systemClock } from './types.js';

/** A periodic maintenance task, for example expire_offers (every minute). It must be idempotent. */
export interface Sweeper {
  name: string;
  intervalMs: number;
  run(now: Date): Promise<unknown>;
}

/**
 * Runs each sweeper when its interval has passed. Several workers may run the same sweeper; sweeper bodies
 * must be safe for that (single UPDATE ... WHERE ... RETURNING statements are). A failing sweeper does not stop the others.
 * Concrete sweepers (expire_offers) are added by the offer tasks and registered in worker.ts.
 */
export class SweeperSchedule {
  private readonly lastRun = new Map<string, number>();
  constructor(
    private readonly sweepers: readonly Sweeper[],
    private readonly clock: JobsClock = systemClock,
    private readonly logger: JobsLogger = silentLogger,
  ) {}

  async tick(): Promise<string[]> {
    const ran: string[] = [];
    const now = this.clock.now();
    for (const s of this.sweepers) {
      const last = this.lastRun.get(s.name);
      if (last !== undefined && now.getTime() - last < s.intervalMs) continue;
      this.lastRun.set(s.name, now.getTime());
      try {
        await s.run(now);
        ran.push(s.name);
      } catch {
        this.logger.error({ sweeper: s.name }, 'sweeper failed');
      }
    }
    return ran;
  }
}
