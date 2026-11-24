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

export function workerOptions() {
  return {
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration: env.SEND_LOCK_TTL_MS,
    stalledInterval: env.SEND_LOCK_TTL_MS + 10000,
    limiter: {
      max: 1,
      duration: env.MIN_SEND_DELAY_MS,
    },
  };
}

export async function closeQueue() {
  await emailQueue.close();
}
