import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coordinatedRivalIqFetch } from '../../../supabase/functions/_shared/competitive/rivaliqConnection';

beforeEach(() => {
  vi.stubGlobal('Deno', { env: { get: () => 'https://x.supabase.co' } });
  vi.stubGlobal('AbortSignal', { timeout: () => new AbortController().signal, any: (signals: AbortSignal[]) => signals[0] });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/rest/v1/rpc/claim_rivaliq_request')) return new Response(JSON.stringify({ acquired: true }), { status: 200 });
    if (url.includes('/rest/v1/rpc/release_rivaliq_request')) return new Response(null, { status: 204 });
    if (url.includes('api.rivaliq.com')) return new Response(null, { status: 204 });
    throw new Error(`unexpected ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('passes a provider answer with no body (a DELETE answered 204) through without rebuilding it with one', async () => {
  const r = await coordinatedRivalIqFetch('https://api.rivaliq.com/v3/landscapes/1?apiKey=k', { method: 'DELETE' });
  expect(r.status).toBe(204);
  expect(await r.text()).toBe('');
});
