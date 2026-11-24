import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: positiveInt(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(8).default('dev-only-secret-change-me'),
  DEVELOPER_ACCESS_EMAIL: z.string().email().default('demo@reachinbox.ai'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/api/auth/google/callback'),

  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().default('http://localhost:4000/api/auth/slack/callback'),
  SLACK_CHANNEL: z.string().default('#general'),
  // Optional: a Bot User OAuth Token (xoxb-…) used as the OAuth fallback on
  // private/trial workspaces where the code exchange is not honored.
  SLACK_BOT_TOKEN: z.string().default(''),
  // Pins the OAuth authorize step to a specific workspace. Required for
  // private apps; leave blank for public apps (any workspace can install).
  SLACK_TEAM_ID: z.string().default(''),

  ELASTICSEARCH_NODE: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().default('reachinbox-emails'),
  ELASTICSEARCH_ENABLED: z.enum(['true', 'false']).default('true'),

  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_PORT: positiveInt(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM_NAME: z.string().default('ReachInbox Scheduler'),

  WORKER_CONCURRENCY: positiveInt(5),
  MIN_SEND_DELAY_MS: positiveInt(2000),
  MAX_EMAILS_PER_HOUR: positiveInt(200),
  RATE_LIMIT_SCOPE: z.enum(['global', 'sender']).default('sender'),
  JOB_ATTEMPTS: positiveInt(5),
  MAX_BATCH_SIZE: positiveInt(5000),
  MAX_SCHEDULE_AHEAD_HOURS: positiveInt(720),

  DEV_LOGIN_ENABLED: z.enum(['true', 'false']).default('false'),
});

export const env = schema.parse(process.env);

export const isProd = env.NODE_ENV === 'production';
export const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const slackConfigured = Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
export const elasticEnabled = env.ELASTICSEARCH_ENABLED === 'true';
export const DEV_LOGIN_ENABLED = env.DEV_LOGIN_ENABLED === 'true';
