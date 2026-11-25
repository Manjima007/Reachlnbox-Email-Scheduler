import { redis, HOUR_MS, hourWindow } from './redis';
import { env } from './env';

const RATE_LIMIT_SCRIPT = `
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= limit then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], windowMs)
    ttl = windowMs
  end
  return {0, current, ttl}
end
current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], windowMs)
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], windowMs)
  ttl = windowMs
end
return {1, current, ttl}
`;

export interface RateLimitDecision {
  allowed: boolean;
  count: number;
  window: number;
  retryAt: number;
  key: string;
}

export function rateLimitKey(fromEmail: string, now = Date.now()) {
  const scope = env.RATE_LIMIT_SCOPE === 'global' ? 'global' : fromEmail.toLowerCase();
  const window = hourWindow(now);
  return { key: `rl:${env.RATE_LIMIT_SCOPE}:${scope}:${window}`, window };
}

export async function checkRateLimit(
  fromEmail: string,
  limit: number,
  now = Date.now(),
): Promise<RateLimitDecision> {
  const { key, window } = rateLimitKey(fromEmail, now);
  const result = (await redis.eval(RATE_LIMIT_SCRIPT, 1, key, String(limit), String(HOUR_MS))) as [
    number,
    number,
    number,
  ];
  const windowStart = window * HOUR_MS;
  return {
    allowed: result[0] === 1,
    count: result[1],
    window,
    key,
    retryAt: windowStart + HOUR_MS + 250,
  };
}

export async function shouldSendSlackAlert(decision: RateLimitDecision): Promise<boolean> {
  const result = await redis.set(decision.key + ':alert', '1', 'PX', HOUR_MS, 'NX');
  return result === 'OK';
}
