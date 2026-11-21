import type { OutboxSender } from './outbox-sender.js';
import type { JobRunner } from './runner.js';
import type { SweeperSchedule } from './sweepers.js';
import { type JobsLogger, silentLogger } from './types.js';

export interface WorkerLoop {
  start(): void;
  /** Stops scheduling and waits for the tick in progress. */
  stop(): Promise<void>;
}

/** Polls the runner, outbox sender and sweepers. Ticks never overlap; an error in one stage is logged and does not stop the loop. */
export function createWorkerLoop(o: {
  runner: JobRunner;
  sender: OutboxSender;
  sweepers?: SweeperSchedule;
  pollMs?: number;
  logger?: JobsLogger;
}): WorkerLoop {
  const pollMs = o.pollMs ?? 1_000;
  const logger = o.logger ?? silentLogger;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let stopped = true;
  const stage = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch { logger.error({ stage: name }, 'worker stage failed'); }
  };
  const once = async () => {
    await stage('jobs', () => o.runner.tick());
    await stage('outbox', () => o.sender.tick());
    if (o.sweepers) await stage('sweepers', () => o.sweepers!.tick());
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = once().finally(() => { running = undefined; schedule(); });
    }, pollMs);
  };
  return {
    start() { if (!stopped) return; stopped = false; schedule(); },
    async stop() { stopped = true; if (timer) clearTimeout(timer); await running; },
  };
}
