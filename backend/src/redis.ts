import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (error) => console.error('[redis] connection error:', error.message));

export const HOUR_MS = 60 * 60 * 1000;

export function hourWindow(now = Date.now()) {
  return Math.floor(now / HOUR_MS);
}
