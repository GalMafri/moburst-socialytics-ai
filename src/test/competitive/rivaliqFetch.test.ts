import { it, expect, vi } from 'vitest';
import { rivalIqFetch } from '../../../supabase/functions/_shared/competitive/rivaliqFetch';
const url = 'https://api.rivaliq.com/v3/landscapes?apiKey=fixture';
function fixture(replies: Response[]) {
  const fetch = vi.fn(async () => replies.shift()!);
  const sleep = vi.fn(async (_ms: number) => {});
  return { fetch, sleep, random: () => 0, now: () => Date.parse('2026-09-24T09:00:00Z') };
}
it('recovers a read collision with exponential delays', async () => {
  const f = fixture([new Response('ConcurrencyLimitExceeded', { status: 429 }), new Response('', { status: 503 }), new Response('ok')]);
  expect(await (await rivalIqFetch(url, {}, f)).text()).toBe('ok');
  expect(f.sleep.mock.calls).toEqual([[1000], [2000]]);
});
it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('never retries %s', async method => {
  const f = fixture([new Response('uncertain', { status: 503 })]);
  expect((await rivalIqFetch(url, { method }, f)).status).toBe(503);
  expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.sleep).not.toHaveBeenCalled();
});
it('does not hammer the exhausted hourly quota', async () => {
  const f = fixture([new Response('{"error":"HourRateLimitExceeded"}', { status: 429 })]);
  expect(await (await rivalIqFetch(url, {}, f)).text()).toContain('HourRateLimitExceeded');
  expect(f.fetch).toHaveBeenCalledTimes(1);
});
it.each(['60', 'Thu, 24 Sep 2026 09:01:00 GMT'])('does not shorten Retry-After %s', async header => {
  const f = fixture([new Response('slow down', { status: 429, headers: { 'Retry-After': header } })]);
  expect((await rivalIqFetch(url, {}, f)).status).toBe(429); expect(f.sleep).not.toHaveBeenCalled();
});
it('honors short Retry-After and stops after four attempts', async () => {
  const f = fixture(Array.from({ length: 4 }, () => new Response('busy', { status: 429, headers: { 'Retry-After': '2' } })));
  expect((await rivalIqFetch(url, {}, f)).status).toBe(429);
  expect(f.fetch).toHaveBeenCalledTimes(4); expect(f.sleep.mock.calls).toEqual([[2000], [2000], [4000]]);
});
it('preserves auth failures and network exceptions', async () => {
  const f = fixture([new Response('denied', { status: 403 })]);
  expect((await rivalIqFetch(url, {}, f)).status).toBe(403); expect(f.fetch).toHaveBeenCalledTimes(1);
  f.fetch.mockRejectedValueOnce(new Error('network'));
  await expect(rivalIqFetch(url, {}, f)).rejects.toThrow('network');
});
it('does not retry after cancellation during backoff', async () => {
  const controller = new AbortController();
  const f = fixture([new Response('busy', { status: 429 })]);
  f.sleep.mockImplementation(async () => controller.abort());
  await expect(rivalIqFetch(url, { signal: controller.signal }, f)).rejects.toThrow();
  expect(f.fetch).toHaveBeenCalledTimes(1);
});
