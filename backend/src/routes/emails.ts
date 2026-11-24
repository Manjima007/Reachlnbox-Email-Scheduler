import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import type { JobType } from 'bullmq';
import { z } from 'zod';
import { env } from '../env';
import { prisma } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import { type AuthedRequest, requireAuth } from '../middleware/auth';
import { EMAIL_QUEUE_NAME, emailQueue } from '../queue';
import type { EmailJobData } from '../types';
import { indexEmails, searchEmails } from '../search';
import { extractEmails } from '../utils/emails';

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

function emailView(email: {
  id: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: string;
  sendAt: Date;
  createdAt: Date;
  sentAt: Date | null;
  rateLimitHits: number;
  previewUrl: string | null;
  error: string | null;
  sequence: number;
}) {
  return {
    id: email.id,
    toEmail: email.toEmail,
    fromEmail: email.fromEmail,
    subject: email.subject,
    body: email.body,
    status: email.status,
    sendAt: email.sendAt.toISOString(),
    createdAt: email.createdAt.toISOString(),
    sentAt: email.sentAt ? email.sentAt.toISOString() : null,
    rateLimitHits: email.rateLimitHits,
    previewUrl: email.previewUrl,
    error: email.error,
    sequence: email.sequence,
  };
}

const batchSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(50000),
  fromEmail: z.string().trim().email(),
  startTime: z.string().datetime({ offset: true }).or(z.string().datetime()),
  delayMs: z.coerce.number().int().min(0).max(24 * 60 * 60 * 1000).default(env.MIN_SEND_DELAY_MS),
  hourlyLimit: z.coerce
    .number()
    .int()
    .positive()
    .max(env.MAX_EMAILS_PER_HOUR)
    .default(env.MAX_EMAILS_PER_HOUR),
  recipients: z.array(z.string().email()).optional(),
  leads: z.string().optional(),
});

function resolveRecipients(input: z.infer<typeof batchSchema>): string[] {
  const fromArray = (input.recipients ?? []).map((value) => value.toLowerCase());
  const fromText = input.leads ? extractEmails(input.leads) : [];
  return Array.from(new Set([...fromArray, ...fromText]));
}

emailsRouter.post(
  '/batches',
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }

    const recipients = resolveRecipients(parsed.data);
    if (recipients.length === 0) {
      res.status(400).json({ error: 'No valid email addresses found' });
      return;
    }
    if (recipients.length > env.MAX_BATCH_SIZE) {
      res.status(400).json({ error: `Maximum ${env.MAX_BATCH_SIZE} recipients per batch` });
      return;
    }

    const startTime = new Date(parsed.data.startTime);
    if (Number.isNaN(startTime.getTime())) {
      res.status(400).json({ error: 'Invalid startTime' });
      return;
    }
    const maxAhead = Date.now() + env.MAX_SCHEDULE_AHEAD_HOURS * 60 * 60 * 1000;
    const lastSendAt = startTime.getTime() + (recipients.length - 1) * parsed.data.delayMs;
    if (startTime.getTime() > maxAhead || lastSendAt > maxAhead) {
      res.status(400).json({ error: 'Schedule is too far in the future' });
      return;
    }

    const idempotencyKey = req.header('Idempotency-Key')?.slice(0, 200);
    if (idempotencyKey) {
      const existing = await prisma.batch.findUnique({
        where: { idempotencyKey },
        include: { _count: { select: { emails: true } } },
      });
      if (existing) {
        res.json({ batchId: existing.id, total: existing.total, duplicate: true });
        return;
      }
    }

    const fromEmail = parsed.data.fromEmail.toLowerCase();
    let emailRows: Array<{
      id: string;
      jobId: string;
      userId: string;
      toEmail: string;
      fromEmail: string;
      subject: string;
      body: string;
      sendAt: Date;
      sequence: number;
      status: string;
    }> = [];

    async function cleanupFailedBatch(batchId: string | null) {
      let cleaned = true;
      try {
        await prisma.email.deleteMany({ where: { id: { in: emailRows.map((row) => row.id) } } });
        if (batchId) {
          await prisma.batch.delete({ where: { id: batchId } });
        }
      } catch (error) {
        console.error('[schedule] database cleanup failed:', error);
        cleaned = false;
      }
      for (const row of emailRows) {
        try {
          await emailQueue.remove(row.jobId);
        } catch (error) {
          console.error('[schedule] queue cleanup failed:', error);
          cleaned = false;
        }
      }
      return cleaned;
    }

    let batch: { id: string } | null = null;
    try {
      batch = await prisma.$transaction(async (tx) => {
        const sender = await tx.sender.upsert({
          where: { userId_email: { userId: req.user!.id, email: fromEmail } },
          update: {},
          create: { userId: req.user!.id, email: fromEmail, hourlyLimit: parsed.data.hourlyLimit },
        });
        const created = await tx.batch.create({
          data: {
            userId: req.user!.id,
            senderId: sender.id,
            fromEmail,
            subject: parsed.data.subject,
            body: parsed.data.body,
            startTime,
            delayMs: parsed.data.delayMs,
            hourlyLimit: parsed.data.hourlyLimit,
            total: recipients.length,
            idempotencyKey,
          },
        });
        emailRows = recipients.map((toEmail, index) => {
          const id = randomUUID();
          return {
            id,
            jobId: `${created.id}:${index + 1}`,
            userId: req.user!.id,
            toEmail,
            fromEmail,
            subject: parsed.data.subject,
            body: parsed.data.body,
            sendAt: new Date(startTime.getTime() + index * parsed.data.delayMs),
            sequence: index + 1,
            status: 'scheduled',
          };
        });
        await tx.email.createMany({
          data: emailRows.map((row) => ({ ...row, batchId: created.id, senderId: sender.id })),
        });
        return created;
      });

      const jobs = emailRows.map((row) => {
        const data: EmailJobData = {
          emailId: row.id,
          userId: req.user!.id,
          toEmail: row.toEmail,
          fromEmail,
          subject: row.subject,
          body: row.body,
          hourlyLimit: parsed.data.hourlyLimit,
          minDelayMs: parsed.data.delayMs,
          sequence: row.sequence,
        };
        return {
          name: 'send-email',
          data,
          opts: {
            jobId: row.jobId,
            delay: Math.max(0, row.sendAt.getTime() - Date.now()),
            priority: Math.min(row.sequence, 1000000),
          },
        };
      });

      for (let i = 0; i < jobs.length; i += 500) {
        await emailQueue.addBulk(jobs.slice(i, i + 500));
      }

      void indexEmails(
        emailRows.map((row) => ({
          ...row,
          sentAt: null,
        })),
      ).catch((error) => console.warn('[search] indexing failed:', error.message));

      res.status(201).json({
        batchId: batch.id,
        total: recipients.length,
        startTime: startTime.toISOString(),
        delayMs: parsed.data.delayMs,
        hourlyLimit: parsed.data.hourlyLimit,
      });
    } catch (error) {
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        const targetsKey = Array.isArray(target)
          ? target.includes('idempotencyKey')
          : String(target ?? '').includes('idempotencyKey');
        if (targetsKey) {
          const existing = await prisma.batch.findUnique({ where: { idempotencyKey } });
          if (existing) {
            res.json({ batchId: existing.id, total: existing.total, duplicate: true });
            return;
          }
        }
      }
      console.error('[schedule] failed:', error);
      await cleanupFailedBatch(batch?.id ?? null);
      res.status(500).json({ error: 'Could not schedule the batch' });
    }
  }),
);

emailsRouter.post(
  '/emails',
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = batchSchema.extend({ recipients: z.array(z.string().email()).length(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }
    req.body = parsed.data;
    res.locals.single = true;
    res.redirect(307, '/api/batches');
  }),
);

emailsRouter.get(
  '/emails',
  asyncHandler(async (req: AuthedRequest, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const statuses: Record<string, string[]> = {
      all: ['scheduled', 'processing', 'rate_limited', 'sent', 'failed', 'cancelled'],
      scheduled: ['scheduled', 'processing', 'rate_limited'],
      sent: ['sent', 'failed'],
      failed: ['failed'],
    };
    const where = {
      userId: req.user!.id,
      status: { in: statuses[status] ?? statuses.all },
    };
    const [rows, total] = await Promise.all([
      prisma.email.findMany({
        where,
        orderBy: [{ sendAt: 'asc' }, { sequence: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.email.count({ where }),
    ]);
    res.json({ data: rows.map(emailView), total, limit, offset });
  }),
);

emailsRouter.get(
  '/emails/search',
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 1) {
      res.json({ data: [], source: 'database' });
      return;
    }
    const result = await searchEmails(req.user!.id, q.slice(0, 200), 100);
    res.json({ data: result.emails, source: result.source });
  }),
);

emailsRouter.get(
  '/emails/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const email = await prisma.email.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    res.json({ data: emailView(email) });
  }),
);

emailsRouter.delete(
  '/emails/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const email = await prisma.email.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    if (['sent', 'failed', 'cancelled'].includes(email.status)) {
      res.status(409).json({ error: `Cannot cancel an email with status ${email.status}` });
      return;
    }
    if (email.jobId) {
      try {
        await emailQueue.remove(email.jobId);
      } catch (error) {
        console.warn('[cancel] queue removal failed:', error);
      }
    }
    await prisma.email.update({
      where: { id: email.id },
      data: { status: 'cancelled', error: 'Cancelled by user' },
    });
    res.json({ ok: true });
  }),
);

emailsRouter.get(
  '/stats',
  asyncHandler(async (req: AuthedRequest, res) => {
    const grouped = await prisma.email.groupBy({
      by: ['status'],
      where: { userId: req.user!.id },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.status] = row._count._all;
    res.json({
      scheduled: (counts.scheduled ?? 0) + (counts.processing ?? 0) + (counts.rate_limited ?? 0),
      sent: counts.sent ?? 0,
      failed: counts.failed ?? 0,
      cancelled: counts.cancelled ?? 0,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    });
  }),
);

emailsRouter.get(
  '/batches',
  asyncHandler(async (req: AuthedRequest, res) => {
    const batches = await prisma.batch.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { emails: { select: { status: true } } },
    });
    res.json({
      data: batches.map((batch) => ({
        id: batch.id,
        subject: batch.subject,
        total: batch.total,
        startTime: batch.startTime.toISOString(),
        delayMs: batch.delayMs,
        hourlyLimit: batch.hourlyLimit,
        fromEmail: batch.fromEmail,
        sent: batch.emails.filter((email) => email.status === 'sent').length,
        failed: batch.emails.filter((email) => email.status === 'failed').length,
        scheduled: batch.emails.filter((email) =>
          ['scheduled', 'processing', 'rate_limited'].includes(email.status),
        ).length,
      })),
    });
  }),
);

emailsRouter.get(
  '/senders',
  asyncHandler(async (req: AuthedRequest, res) => {
    const senders = await prisma.sender.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ data: senders });
  }),
);

emailsRouter.post(
  '/senders',
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      email: z.string().trim().email(),
      name: z.string().trim().max(120).optional(),
      hourlyLimit: z.number().int().positive().max(env.MAX_EMAILS_PER_HOUR).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid sender' });
      return;
    }
    const sender = await prisma.sender.upsert({
      where: { userId_email: { userId: req.user!.id, email: parsed.data.email.toLowerCase() } },
      update: { name: parsed.data.name, hourlyLimit: parsed.data.hourlyLimit },
      create: {
        userId: req.user!.id,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        hourlyLimit: parsed.data.hourlyLimit,
      },
    });
    res.status(201).json({ data: sender });
  }),
);

emailsRouter.get(
  '/queue/stats',
  asyncHandler(async (_req, res) => {
    const counts = await emailQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'completed',
      'failed',
      'paused',
    );
    res.json({
      queue: EMAIL_QUEUE_NAME,
      counts,
      concurrency: env.WORKER_CONCURRENCY,
      minDelayMs: env.MIN_SEND_DELAY_MS,
      maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
      rateLimitScope: env.RATE_LIMIT_SCOPE,
    });
  }),
);

emailsRouter.get(
  '/queue/jobs',
  asyncHandler(async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : 'delayed';
    const allowed = ['waiting', 'active', 'delayed', 'completed', 'failed'];
    if (!allowed.includes(state)) {
      res.status(400).json({ error: 'Invalid state' });
      return;
    }
    const jobs = await emailQueue.getJobs([state as JobType], 0, 24, false);
    res.json({
      data: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        state: state,
        toEmail: job.data?.toEmail,
        fromEmail: job.data?.fromEmail,
        subject: job.data?.subject,
        sendAt: new Date(job.timestamp + (job.delay ?? 0)).toISOString(),
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? null,
      })),
    });
  }),
);
