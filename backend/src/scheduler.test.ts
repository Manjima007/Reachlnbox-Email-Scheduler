import { afterAll, describe, expect, it } from 'vitest';
import { extractEmails } from './utils/emails';
import { checkRateLimit } from './rateLimiter';
import { redis } from './redis';

afterAll(async () => {
  await redis.quit();
});

describe('lead parsing', () => {
  it('deduplicates emails from CSV/text content', () => {
    expect(extractEmails('a@x.com,b@y.com\nA@X.com; hello c@z.io')).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.io',
    ]);
  });
});

describe('redis backed hourly limiter', () => {
  it('allows up to the limit, blocks the next send, and does not inflate the counter', async () => {
    const sender = `test-${Date.now()}@example.com`;
    const first = await checkRateLimit(sender, 2);
    const second = await checkRateLimit(sender, 2);
    const third = await checkRateLimit(sender, 2);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.count).toBe(2); // blocked send must not increment the counter
    expect(third.retryAt).toBeGreaterThan(Date.now());
  });
});
