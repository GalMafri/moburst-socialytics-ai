import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { fetchWithRateLimitRetry } from '../../../supabase/functions/_shared/competitive/fetchWithRateLimitRetry';
describe('provider rate limit recovery', () => {
  beforeAll(() => vi.stubGlobal('AbortSignal', { timeout: () => new AbortController().signal }));
  afterAll(() => vi.unstubAllGlobals());
  it('honors a short provider delay and recovers', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('retry after 1s', {status:429})).mockResolvedValueOnce(new Response('ok'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect((await fetchWithRateLimitRetry('https://example.com', {}, 1000, {fetch,sleep})).status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('bounds persistent throttling and preserves the failure', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response('busy', {status:429}));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect((await fetchWithRateLimitRetry('https://example.com', {}, 1000, {fetch,sleep})).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('does not retry a long quota window or other errors', async () => {
    for (const status of [429,401,500]) {
      const fetch = vi.fn().mockImplementation(async () => new Response('error',{status,headers:{'Retry-After':'60'}}));
      const sleep = vi.fn();
      expect((await fetchWithRateLimitRetry('https://example.com', {}, 1000, {fetch,sleep})).status).toBe(status);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });
});
