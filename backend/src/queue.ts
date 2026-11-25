import { Queue } from 'bullmq';
import { env } from './env';
import type { EmailJobData, EmailJobResult } from './types';

export const EMAIL_QUEUE_NAME = 'email-sends';

const url = new URL(env.REDIS_URL);

export const bullConnection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  username: url.username || undefined,
  password: url.password || undefined,
  db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
  tls: url.protocol === 'rediss:' ? {} : undefined,
  maxRetriesPerRequest: null as null,
};

export const emailQueue = new Queue<EmailJobData, EmailJobResult>(EMAIL_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: env.JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  },
});

// Apply the throttle at the worker level: at most 1 send every MIN_SEND_DELAY_MS
// per worker instance, with the configured concurrency. This is the "minimum delay
// between individual sends" required by the assignment — BullMQ's limiter option.
export function workerOptions() {
  return {
    concurrency: env.WORKER_CONCURRENCY,
    limiter: {
      max: 1,
      duration: env.MIN_SEND_DELAY_MS,
      // Key by scope so multiple workers/instances share the same throttle.
      key: `send-limiter:${env.RATE_LIMIT_SCOPE === 'global' ? 'global' : 'per-sender'}`,
    },
  };
}

export async function closeQueue() {
  await emailQueue.close();
}
