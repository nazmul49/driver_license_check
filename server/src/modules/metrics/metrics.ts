import client from 'prom-client';
import type { JobRepository } from '../jobs/job.repository.js';
import type { ResultRepository } from '../processing/result.repository.js';
import type { SessionRepository } from '../sessions/session.repository.js';

/**
 * API-side metrics are computed from the database at scrape time, so every API instance
 * reports the same totals. Processing histograms live in the worker process (worker-metrics).
 */
export function createApiMetrics(d: {
  sessions: SessionRepository;
  results: ResultRepository;
  jobs: JobRepository;
}) {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: 'dlc_api_' });

  new client.Gauge({
    name: 'dlc_sessions_by_status',
    help: 'Sessions by status',
    labelNames: ['status'],
    registers: [registry],
    async collect() {
      this.reset();
      for (const r of await d.sessions.countByStatus()) this.set({ status: r.status }, r.n);
    },
  });
  new client.Gauge({
    name: 'dlc_decisions_total',
    help: 'Completed sessions by decision',
    labelNames: ['decision'],
    registers: [registry],
    async collect() {
      this.reset();
      for (const r of await d.sessions.countByDecision()) this.set({ decision: r.decision }, r.n);
    },
  });
  new client.Gauge({
    name: 'dlc_check_results_total',
    help: 'Failed and warned check results by code',
    labelNames: ['code', 'status'],
    registers: [registry],
    async collect() {
      this.reset();
      for (const r of await d.results.checkFailCounts())
        this.set({ code: r.code, status: r.status }, r.n);
    },
  });
  new client.Gauge({
    name: 'dlc_job_queue_depth',
    help: 'Queued jobs',
    registers: [registry],
    async collect() {
      this.set(await d.jobs.queueDepth());
    },
  });
  return registry;
}

export function createWorkerMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: 'dlc_worker_' });
  return {
    registry,
    processingDuration: new client.Histogram({
      name: 'dlc_processing_duration_seconds',
      help: 'End-to-end processing time per session',
      buckets: [1, 2, 5, 10, 15, 20, 30, 45, 60],
      registers: [registry],
    }),
    stepDuration: new client.Histogram({
      name: 'dlc_processing_step_duration_seconds',
      help: 'Processing time per pipeline step',
      labelNames: ['step'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
      registers: [registry],
    }),
    ocrConfidence: new client.Histogram({
      name: 'dlc_ocr_confidence',
      help: 'Mean OCR confidence per session (0..1)',
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
      registers: [registry],
    }),
    jobsTotal: new client.Counter({
      name: 'dlc_jobs_total',
      help: 'Jobs handled by outcome',
      labelNames: ['type', 'outcome'],
      registers: [registry],
    }),
  };
}

export type WorkerMetrics = ReturnType<typeof createWorkerMetrics>;
