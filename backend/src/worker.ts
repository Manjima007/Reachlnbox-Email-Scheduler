import { randomUUID } from 'crypto';
import { Worker } from 'bullmq';
import { prisma } from './db';
import { bullConnection, EMAIL_QUEUE_NAME, emailQueue, workerOptions } from './queue';
import { env } from './env';
import { clearSlackAlert, checkRateLimit, releaseRateLimitSlot, shouldSendSlackAlert } from './rateLimiter';
import { redis, HOUR_MS } from './redis';
import { sendEmail } from './mailer';
import { notifySlackRateLimit } from './slack';
import { indexEmail } from './search';
import type { EmailJobData, EmailJobResult } from './types';

const terminalStatuses = new Set(['sent', 'cancelled']);
const workerId = randomUUID();
const recoveryLockKey = 'reachinbox:recovery:lock';
const HEARTBEAT_TTL_MS = Math.min(15000, Math.max(5000, Math.floor(env.SEND_LOCK_TTL_MS / 3)));
let heartbeatTimer: NodeJS.Timeout | null = null;
let recoveryTimer: NodeJS.Timeout | null = null;

const workerHeartbeatKey = (owner: string) => `reachinbox:worker:${owner}:heartbeat`;

const RELEASE_RECOVERY_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function staleBefore() {
  return new Date(Date.now() - env.SEND_LOCK_TTL_MS);
}

async function markWorkerAlive() {
  await redis.set(workerHeartbeatKey(workerId), '1', 'PX', HEARTBEAT_TTL_MS);
}

export function startWorkerHeartbeat() {
  if (heartbeatTimer) {
    return;
  }
  void markWorkerAlive().catch((error) => console.error('[worker] heartbeat failed:', error.message));
  heartbeatTimer = setInterval(() => {
    void markWorkerAlive().catch((error) => console.error('[worker] heartbeat failed:', error.message));
  }, Math.max(1000, Math.floor(HEARTBEAT_TTL_MS / 3)));
  heartbeatTimer.unref?.();
}

export async function stopWorkerHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  await redis.del(workerHeartbeatKey(workerId));
}

async function isWorkerAlive(owner: string | null) {
  if (!owner) {
    return false;
  }
  return (await redis.pttl(workerHeartbeatKey(owner))) > 0;
}

export function startRecoveryLoop() {
  if (recoveryTimer) {
    return;
  }
  recoveryTimer = setInterval(() => {
    void bootstrap().catch((error) => console.error('[worker] recovery retry failed:', error.message));
  }, Math.max(60000, env.SEND_LOCK_TTL_MS * 2));
  recoveryTimer.unref?.();
}

export function stopRecoveryLoop() {
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
}

function lockMatches(email: { lockedAt: Date | null; lockOwner: string | null }) {
  return email.lockedAt
    ? [{ lockedAt: email.lockedAt }, { lockOwner: email.lockOwner }]
    : [{ lockedAt: null }];
}

function jobData(email: {
  id: string;
  userId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  sequence: number;
}, hourlyLimit: number, minDelayMs: number): EmailJobData {
  return {
    emailId: email.id,
    userId: email.userId,
    toEmail: email.toEmail,
    fromEmail: email.fromEmail,
    subject: email.subject,
    body: email.body,
    hourlyLimit,
    minDelayMs,
    sequence: email.sequence,
  };
}

async function enqueueEmail(email: {
  id: string;
  jobId: string | null;
  userId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  sequence: number;
  sendAt: Date;
  availableAt: Date | null;
  batch: { delayMs: number; hourlyLimit: number } | null;
  sender: { hourlyLimit: number | null } | null;
}, jobId = email.jobId ?? email.id) {
  const delay = Math.max(0, (email.availableAt ?? email.sendAt).getTime() - Date.now());
  const limit = email.batch?.hourlyLimit ?? email.sender?.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR;
  await emailQueue.add(
    'send-email',
    jobData(email, limit, email.batch?.delayMs ?? env.MIN_SEND_DELAY_MS),
    {
      jobId,
      delay,
      priority: Math.min(email.sequence || 1, 1000000),
    },
  );
}

export async function processEmailJob(job: import('bullmq').Job<EmailJobData>): Promise<EmailJobResult> {
  const data = job.data;
  const email = await prisma.email.findUnique({
    where: { id: data.emailId },
    include: { batch: true, sender: true },
  });

  if (!email || terminalStatuses.has(email.status)) {
    return { status: 'skipped', reason: email?.status ?? 'missing' };
  }
  if (email.lockedAt && email.lockedAt > staleBefore()) {
    throw new Error(`Email ${email.id} is locked by another worker`);
  }

  const claim = await prisma.email.updateMany({
    where: {
      id: email.id,
      status: { in: ['scheduled', 'rate_limited'] },
      AND: [
        ...lockMatches(email),
        {
          OR: [{ availableAt: null }, { availableAt: { lte: new Date() } }],
        },
      ],
    },
    data: {
      status: 'processing',
      lockedAt: new Date(),
      lockOwner: workerId,
      sendAttempts: { increment: 1 },
      error: null,
    },
  });

  if (claim.count === 0) {
    return { status: 'skipped', reason: 'not claimable' };
  }

  const limit = email.batch?.hourlyLimit ?? data.hourlyLimit;
  const decision = await checkRateLimit(data.fromEmail, limit);

  if (!decision.allowed) {
    const retryAt = decision.retryAt;
    const nextJobId = `${email.id}:rl:${email.rateLimitHits + 1}`;
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: 'rate_limited',
        lockedAt: null,
        lockOwner: null,
        availableAt: new Date(retryAt),
        sendAt: new Date(retryAt),
        rateLimitHits: { increment: 1 },
        jobId: nextJobId,
        error: `Hourly limit ${limit} reached for ${data.fromEmail}; rescheduled`,
      },
    });

    try {
      const user = await prisma.user.findUnique({
        where: { id: data.userId },
        select: { slackAccessToken: true, slackWebhookUrl: true },
      });

      if (user && (user.slackAccessToken || user.slackWebhookUrl)) {
        if (await shouldSendSlackAlert(decision)) {
          const sent = await notifySlackRateLimit(user, {
            fromEmail: data.fromEmail,
            limit,
            count: decision.count,
            retryAt,
          });
          if (!sent) {
            await clearSlackAlert(decision);
          }
          console.log(`[slack] rate-limit alert for ${data.fromEmail}: ${sent ? 'sent' : 'failed'}`);
        }
      }

      console.log(`[rate-limit] ${data.fromEmail} ${decision.count}/${limit}, next window ${new Date(retryAt).toISOString()}`);
      await enqueueEmail(
        {
          ...email,
          availableAt: new Date(retryAt),
          sendAt: new Date(retryAt),
          batch: email.batch,
          sender: email.sender,
        },
        nextJobId,
      );
      return { status: 'rescheduled', nextAt: retryAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.email.update({
        where: { id: email.id },
        data: {
          status: 'scheduled',
          lockedAt: null,
          lockOwner: null,
          availableAt: new Date(),
          error: message,
        },
      });
      throw error;
    }
  }

  try {
    const result = await sendEmail({
      to: data.toEmail,
      from: data.fromEmail,
      subject: data.subject,
      body: data.body,
    });

    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        error: null,
        lockedAt: null,
        lockOwner: null,
        availableAt: null,
      },
    });

    void indexEmail({
      id: email.id,
      userId: email.userId,
      toEmail: email.toEmail,
      fromEmail: email.fromEmail,
      subject: email.subject,
      body: email.body,
      status: 'sent',
      sendAt: email.sendAt,
      sentAt: new Date(),
    }).catch((error) => console.warn('[search] sent email indexing failed:', error.message));

    console.log(`[sent] ${data.toEmail} via ${data.fromEmail} preview=${result.previewUrl}`);
    return { status: 'sent', messageId: result.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releaseRateLimitSlot(decision);
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: 'scheduled',
        lockedAt: null,
        lockOwner: null,
        availableAt: new Date(),
        error: message,
      },
    });
    throw error;
  }
}

async function bootstrap() {
  const acquired = await redis.set(recoveryLockKey, workerId, 'PX', HOUR_MS, 'NX');
  if (acquired !== 'OK') {
    console.log('[worker] recovery skipped, another instance owns it');
    return;
  }

  try {
    const stale = staleBefore();
    const processing = await prisma.email.findMany({
      where: { status: 'processing' },
      select: { id: true, lockOwner: true },
    });
    for (const row of processing) {
      if (await isWorkerAlive(row.lockOwner)) {
        continue;
      }
      await prisma.email.update({
        where: { id: row.id },
        data: {
          status: 'scheduled',
          lockedAt: null,
          lockOwner: null,
          availableAt: new Date(),
          error: 'Recovered after worker shutdown',
        },
      });
    }

    const pending = await prisma.email.findMany({
      where: {
        status: { in: ['scheduled', 'rate_limited', 'processing'] },
        OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }],
      },
      include: { batch: true, sender: true },
      orderBy: [{ sendAt: 'asc' }, { sequence: 'asc' }],
      take: 10000,
    });

    for (const email of pending) {
      let jobId = email.jobId ?? email.id;
      const existing = await emailQueue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state !== 'completed' && state !== 'failed') {
          continue;
        }
        jobId = `${email.id}:recovered:${randomUUID()}`;
      }
      await enqueueEmail(email, jobId);
      await prisma.email.update({ where: { id: email.id }, data: { jobId } });
    }

    console.log(
      `[worker] ready concurrency=${env.WORKER_CONCURRENCY} minDelay=${env.MIN_SEND_DELAY_MS}ms limit=${env.MAX_EMAILS_PER_HOUR}/h scope=${env.RATE_LIMIT_SCOPE} recovered=${pending.length}`,
    );
  } finally {
    await redis.eval(RELEASE_RECOVERY_LOCK_SCRIPT, 1, recoveryLockKey, workerId);
  }
}

function startStandaloneWorker() {
  startWorkerHeartbeat();
  startRecoveryLoop();
  const worker = new Worker<EmailJobData, EmailJobResult>(
    EMAIL_QUEUE_NAME,
    processEmailJob,
    {
      connection: bullConnection,
      ...workerOptions(),
    },
  );

  worker.on('error', (error) => console.error('[worker] error:', error.message));
  worker.on('failed', (job, error) => {
    if (job?.attemptsMade === env.JOB_ATTEMPTS) {
      console.error(`[worker] job ${job.id} exhausted retries: ${error.message}`);
    }
  });

  return worker;
}

const isMain = typeof require !== 'undefined' && require.main === module;
let standaloneWorker: import('bullmq').Worker<EmailJobData, EmailJobResult> | null = null;

if (isMain) {
  void bootstrap()
    .catch((error) => console.error('[worker] bootstrap failed:', error))
    .finally(() => {
      standaloneWorker = startStandaloneWorker();
      process.on('SIGINT', closeStandalone);
      process.on('SIGTERM', closeStandalone);
    });
}

async function closeStandalone() {
  console.log('[worker] closing...');
  await standaloneWorker?.close();
  stopRecoveryLoop();
  try {
    await stopWorkerHeartbeat();
  } catch (error) {
    console.error('[worker] heartbeat cleanup failed:', error);
  }
  await prisma.$disconnect();
  process.exit(0);
}

export { bootstrap, startStandaloneWorker };

export async function closeWorker() {
  await standaloneWorker?.close();
  stopRecoveryLoop();
  try {
    await stopWorkerHeartbeat();
  } catch (error) {
    console.error('[worker] heartbeat cleanup failed:', error);
  }
}
