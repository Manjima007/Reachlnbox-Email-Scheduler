export interface EmailJobData {
  emailId: string;
  userId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  hourlyLimit: number;
  minDelayMs: number;
  sequence: number;
}

export interface EmailJobResult {
  status: 'sent' | 'rescheduled' | 'skipped';
  messageId?: string;
  nextAt?: number;
  reason?: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  slackConnected: boolean;
  slackTeamId: string | null;
}

export interface EmailView {
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

export interface BatchView {
  id: string;
  subject: string;
  total: number;
  startTime: string;
  delayMs: number;
  hourlyLimit: number;
  scheduled: number;
  sent: number;
  failed: number;
}

export interface QueueStats {
  queue: string;
  counts: Record<string, number>;
  concurrency: number;
  minDelayMs: number;
  maxEmailsPerHour: number;
  rateLimitScope: 'global' | 'sender';
}
