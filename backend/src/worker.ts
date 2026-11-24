import { DelayedError, Worker } from 'bullmq';
import { prisma } from './db';
import { bullConnection, EMAIL_QUEUE_NAME, workerOptions } from './queue';
import { env } from './env';
import { checkRateLimit, shouldSendSlackAlert } from './rateLimiter';
import { sendEmail } from './mailer';
import { notifySlackRateLimit } from './slack';
import { indexEmail } from './search';
import type { EmailJobData, EmailJobResult } from './types';

const terminalStatuses = new Set(['sent', 'cancelled']);

async function reschedule(job: import('bullmq').Job<EmailJobData>, token: string | undefined, nextAt: number): Promise<never> {
  await job.moveToDelayed(Math.max(Date.now() + 25, nextAt), token);
  throw new DelayedError();
}

/**
 * The actual job-processing logic. Exported so the standalone worker (worker.ts)
 * AND the API's in-process worker (server.ts, for single-service deploys like
 * free Render) share the exact same behavior.
 */
export async function processEmailJob(
  job: import('bullmq').Job<EmailJobData>,
  token?: string,
): Promise<EmailJobResult> {
  const data = job.data;

  const email = await prisma.email.findUnique({ where: { id: data.emailId } });
  if (!email || terminalStatuses.has(email.status)) {
    return { status: 'skipped', reason: email?.status ?? 'missing' };
  }

  const limit = data.hourlyLimit;
  const decision = await checkRateLimit(data.fromEmail, limit);

  if (!decision.allowed) {
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: 'rate_limited',
        rateLimitHits: { increment: 1 },
        error: `Hourly limit ${limit} reached for ${data.fromEmail}; rescheduled`,
      },
    });

    if (await shouldSendSlackAlert(decision)) {
      const user = await prisma.user.findUnique({
        where: { id: data.userId },
        select: { slackAccessToken: true, slackWebhookUrl: true },
      });
      const sent = await notifySlackRateLimit(user, {
        fromEmail: data.fromEmail,
        limit,
        count: decision.count,
        retryAt: decision.retryAt,
      });
      console.log(`[slack] rate-limit alert for ${data.fromEmail}: ${sent ? 'sent' : 'not connected/failed'}`);
    }

    console.log(`[rate-limit] ${data.fromEmail} ${decision.count}/${limit}, next window ${new Date(decision.retryAt).toISOString()}`);
    return reschedule(job, token, decision.retryAt);
  }

  await prisma.email.update({
    where: { id: email.id },
    data: { status: 'processing', attempts: { increment: 1 }, error: null },
  });

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
    await prisma.email.update({
      where: { id: email.id },
      data: { status: 'failed', error: message },
    });
    throw error;
  }
}

export function startStandaloneWorker() {
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

async function bootstrap() {
  await prisma.email.updateMany({
    where: { status: 'processing' },
    data: { status: 'scheduled', error: 'Restarted after worker shutdown' },
  });
  console.log(
    `[worker] ready concurrency=${env.WORKER_CONCURRENCY} minDelay=${env.MIN_SEND_DELAY_MS}ms limit=${env.MAX_EMAILS_PER_HOUR}/h scope=${env.RATE_LIMIT_SCOPE}`,
  );
}

// Standalone-mode bookkeeping (only runs when `node dist/worker.js` is executed
// directly; a no-op when imported by server.ts, which runs its own inline worker).
const isMain = typeof require !== 'undefined' && require.main === module;
const standaloneWorker = isMain ? startStandaloneWorker() : null;

if (isMain) {
  bootstrap().catch((error) => console.error('[worker] bootstrap failed:', error));

  process.on('SIGINT', closeStandalone);
  process.on('SIGTERM', closeStandalone);
  async function closeStandalone() {
    console.log('[worker] closing...');
    await standaloneWorker?.close();
    await prisma.$disconnect();
    process.exit(0);
  }
}

export async function closeWorker() {
  await standaloneWorker?.close();
}
