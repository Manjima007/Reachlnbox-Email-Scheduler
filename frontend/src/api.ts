import type {
  AppConfig,
  AuthResponse,
  Email,
  QueueJob,
  QueueStats,
  SchedulePayload,
  ScheduleResponse,
  SearchResult,
  Sender,
  Stats,
} from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Spread init first, then layer credentials + merged headers on top, so a
  // caller-supplied `headers` object (e.g. the Idempotency-Key on schedule)
  // can't clobber the JSON Content-Type that express.json() requires.
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: mergedHeaders,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, response.status);
  }
  return payload as T;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  me: () => request<AuthResponse>('/api/auth/me'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  devLogin: (email?: string, name?: string) =>
    request<{ user: AuthResponse['user'] }>('/api/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    }),
  disconnectSlack: () => request<{ ok: boolean }>('/api/auth/slack/disconnect', { method: 'POST' }),
  setSlackWebhook: (webhookUrl: string) =>
    request<{ ok: boolean; slackConnected: boolean }>('/api/auth/slack/webhook', {
      method: 'POST',
      body: JSON.stringify({ webhookUrl }),
    }),
  testSlack: () => request<{ ok: boolean; delivered: boolean; channel: string | null }>('/api/auth/slack/test', { method: 'POST' }),
  setSlackToken: (token: string) =>
    request<{ ok: boolean; delivered: boolean; botName: string; teamId: string }>('/api/auth/slack/token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  emails: (status: string, limit = 100) =>
    request<{ data: Email[]; total: number }>(`/api/emails?status=${status}&limit=${limit}`),
  email: (id: string) => request<{ data: Email }>(`/api/emails/${id}`),
  cancelEmail: (id: string) => request<{ ok: boolean }>(`/api/emails/${id}`, { method: 'DELETE' }),
  search: (q: string) =>
    request<{ data: SearchResult[]; source: string }>(`/api/emails/search?q=${encodeURIComponent(q)}`),
  stats: () => request<Stats>('/api/stats'),
  senders: () => request<{ data: Sender[] }>('/api/senders'),
  addSender: (email: string, hourlyLimit?: number) =>
    request<{ data: Sender }>('/api/senders', {
      method: 'POST',
      body: JSON.stringify({ email, hourlyLimit }),
    }),
  schedule: (payload: SchedulePayload, idempotencyKey?: string) =>
    request<ScheduleResponse>('/api/batches', {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      body: JSON.stringify(payload),
    }),
  queueStats: () => request<QueueStats>('/api/queue/stats'),
  queueJobs: (state: string) => request<{ data: QueueJob[] }>(`/api/queue/jobs?state=${state}`),
};
