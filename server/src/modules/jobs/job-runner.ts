import { hostname } from 'node:os';
import type { Cradle } from '../../container.js';
import type { Config } from '../../config/index.js';
import type { Clock } from '../../lib/clock.js';
import type { Logger } from '../../lib/logger.js';
import type { WorkerMetrics } from '../metrics/metrics.js';
import type { ProcessingService } from '../processing/processing.service.js';
import type { PurgeService } from '../retention/purge.service.js';
import type { ExpiryService } from '../sessions/expiry.service.js';
import type { DeliverWebhookPayload } from '../webhooks/webhook-events.js';
import type { WebhookService } from '../webhooks/webhook.service.js';
import type { Job, JobRepository } from './job.repository.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Worker loop: polls the job table with SKIP LOCKED, runs handlers with bounded concurrency,
 * retries system errors with backoff, and runs the periodic jobs (expiry, stale job recovery,
 * retention purge). Several worker processes can run side by side.
 */
export class JobRunner {
  readonly workerId = `${hostname()}:${process.pid}`;
  private readonly jobs: JobRepository;
  private readonly processing: ProcessingService;
  private readonly webhooks: WebhookService;
  private readonly expiry: ExpiryService;
  private readonly purge: PurgeService;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly config: Config;
  private readonly metrics: WorkerMetrics;
  private stopping = false;
  private timers: NodeJS.Timeout[] = [];
  private loops: Promise<void>[] = [];

  constructor(
    c: Pick<
      Cradle,
      | 'jobRepository'
      | 'processingService'
      | 'webhookService'
      | 'expiryService'
      | 'purgeService'
      | 'clock'
      | 'logger'
      | 'config'
      | 'workerMetrics'
    >,
  ) {
    this.jobs = c.jobRepository;
    this.processing = c.processingService;
    this.webhooks = c.webhookService;
    this.expiry = c.expiryService;
    this.purge = c.purgeService;
    this.clock = c.clock;
    this.logger = c.logger;
    this.config = c.config;
    this.metrics = c.workerMetrics;
  }

  /** Claim and run one job. Returns false when the queue is empty. Used by tests directly. */
  async runOnce(): Promise<boolean> {
    const job = await this.jobs.claim(this.workerId, this.clock.now());
    if (!job) return false;
    await this.handle(job);
    return true;
  }

  /** Drain the queue (tests and scripts). */
  async drain(max = 100): Promise<number> {
    let n = 0;
    while (n < max && (await this.runOnce())) n++;
    return n;
  }

  private async handle(job: Job): Promise<void> {
    const start = performance.now();
    try {
      if (job.type === 'process_session') {
        await this.processing.process(String(job.payload.session_id));
      } else if (job.type === 'deliver_webhook') {
        await this.webhooks.deliver(job.payload as unknown as DeliverWebhookPayload);
      } else {
        throw new Error(`Unknown job type ${job.type as string}`);
      }
      await this.jobs.complete(job.id, this.clock.now());
      this.metrics.jobsTotal.inc({ type: job.type, outcome: 'done' });
      this.logger.info(
        {
          job_id: job.id,
          type: job.type,
          session_id: job.payload.session_id,
          duration_ms: Math.round(performance.now() - start),
        },
        'job done',
      );
    } catch (err) {
      const message = `${(err as Error).name}: ${(err as Error).message}`;
      const now = this.clock.now();
      if (job.attempts < this.config.JOB_MAX_ATTEMPTS) {
        // Up to 2 retries for system errors (SPEC 6.1).
        await this.jobs.retry(
          job.id,
          new Date(now.getTime() + 30_000 * job.attempts),
          message,
          now,
        );
        this.metrics.jobsTotal.inc({ type: job.type, outcome: 'retry' });
      } else {
        await this.jobs.fail(job.id, message, now);
        this.metrics.jobsTotal.inc({ type: job.type, outcome: 'failed' });
        if (job.type === 'process_session')
          await this.processing.markFailed(String(job.payload.session_id));
      }
      this.logger.error(
        {
          job_id: job.id,
          type: job.type,
          session_id: job.payload.session_id,
          attempts: job.attempts,
          error: (err as Error).name,
        },
        'job error',
      );
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      let worked = false;
      try {
        worked = await this.runOnce();
      } catch (err) {
        this.logger.error({ error: (err as Error).message }, 'job poll failed');
      }
      if (!worked) await new Promise((r) => setTimeout(r, this.config.WORKER_POLL_MS));
    }
  }

  private every(ms: number, name: string, fn: () => Promise<unknown>): void {
    const run = () =>
      fn().catch((err) =>
        this.logger.error({ task: name, error: (err as Error).message }, 'periodic task failed'),
      );
    void run();
    this.timers.push(setInterval(run, ms));
  }

  start(): void {
    for (let i = 0; i < this.config.WORKER_CONCURRENCY; i++) this.loops.push(this.loop());
    this.every(MINUTE, 'expiry', () => this.expiry.run());
    this.every(MINUTE, 'requeue_stale', () => {
      const now = this.clock.now();
      return this.jobs.requeueStale(new Date(now.getTime() - 2 * this.config.JOB_TIMEOUT_MS), now);
    });
    this.every(HOUR, 'retention_purge', () => this.purge.run());
    this.logger.info(
      { worker_id: this.workerId, concurrency: this.config.WORKER_CONCURRENCY },
      'worker started',
    );
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    await Promise.all(this.loops);
  }
}
