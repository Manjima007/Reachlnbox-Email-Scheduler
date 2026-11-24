export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  slackConnected: boolean;
  slackWebhookUrl?: string | null;
  slackTeamId: string | null;
}

export interface AppConfig {
  googleConfigured: boolean;
  slackConfigured: boolean;
  devLoginEnabled: boolean;
  minDelayMs: number;
  maxEmailsPerHour: number;
  rateLimitScope: 'global' | 'sender';
}

export interface AuthResponse {
  user: AuthUser;
  config: AppConfig;
}

export interface Email {
  id: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: string;
  sendAt: string;
  createdAt: string;
  sentAt: string | null;
  rateLimitHits: number;
  previewUrl: string | null;
  error: string | null;
  sequence: number;
}

export interface Sender {
  id: string;
  email: string;
  name: string | null;
  hourlyLimit: number | null;
}

export interface Stats {
  scheduled: number;
  sent: number;
  failed: number;
  cancelled: number;
  total: number;
}

export interface QueueStats {
  queue: string;
  counts: Record<string, number>;
  concurrency: number;
  minDelayMs: number;
  maxEmailsPerHour: number;
  rateLimitScope: 'global' | 'sender';
}

export interface QueueJob {
  id: string | null;
  name: string;
  state: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  sendAt: string;
  attemptsMade: number;
  failedReason: string | null;
}

export interface SearchResult {
  id: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: string;
  sendAt: string;
  sentAt: string | null;
}

export interface SchedulePayload {
  subject: string;
  body: string;
  fromEmail: string;
  startTime: string;
  delayMs: number;
  hourlyLimit: number;
  recipients: string[];
}

export interface ScheduleResponse {
  batchId: string;
  total: number;
  startTime?: string;
  delayMs?: number;
  hourlyLimit?: number;
  duplicate?: boolean;
}
