import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Worker } from 'bullmq';
import { env, googleConfigured, slackConfigured, DEV_LOGIN_ENABLED } from './env';
import { authRouter } from './routes/auth';
import { emailsRouter } from './routes/emails';
import { emailQueue, closeQueue, bullConnection, EMAIL_QUEUE_NAME, workerOptions } from './queue';
import {
  bootstrap,
  processEmailJob,
  startRecoveryLoop,
  startWorkerHeartbeat,
  stopRecoveryLoop,
  stopWorkerHeartbeat,
} from './worker';
import { prisma, disconnectDb } from './db';
import { redis } from './redis';

const app = express();

app.set('trust proxy', 1);
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'reachinbox-email-scheduler', time: new Date().toISOString() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    googleConfigured,
    slackConfigured,
    devLoginEnabled: DEV_LOGIN_ENABLED,
    minDelayMs: env.MIN_SEND_DELAY_MS,
    maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
    rateLimitScope: env.RATE_LIMIT_SCOPE,
  });
});

app.use('/api/auth', authRouter);
app.use('/api', emailsRouter);

const boardAdapter = new ExpressAdapter();
boardAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: boardAdapter,
});
app.use('/admin/queues', boardAdapter.getRouter());

const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
if (env.NODE_ENV === 'production') {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(env.PORT, () => {
  console.log(`[api] listening on http://localhost:${env.PORT}`);
  console.log(`[api] bull dashboard: http://localhost:${env.PORT}/admin/queues`);

  // Single-service deploy mode (free Render has no background-worker service
  // type): run the BullMQ worker in this same process. Set RUN_WORKER=true.
  // On multi-service deploys leave it unset so only the dedicated worker runs.
  if (process.env.RUN_WORKER === 'true') {
    void bootstrap()
      .catch((error) => console.error('[api] recovery failed:', error))
      .finally(() => startInlineWorker());
  }
});

let inlineWorker: Worker | null = null;

function startInlineWorker() {
  startWorkerHeartbeat();
  startRecoveryLoop();
  inlineWorker = new Worker(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: bullConnection,
    ...workerOptions(),
  });
  inlineWorker.on('error', (error) => console.error('[inline-worker] error:', error.message));
  console.log(`[api] inline BullMQ worker started (concurrency=${env.WORKER_CONCURRENCY})`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    console.log(`[api] ${signal} received, closing...`);
    server.close();
    await inlineWorker?.close();
    stopRecoveryLoop();
    try {
      await stopWorkerHeartbeat();
    } catch (error) {
      console.error('[api] heartbeat cleanup failed:', error);
    }
    await closeQueue();
    await disconnectDb();
    redis.disconnect();
    process.exit(0);
  });
}

export { app, prisma };
