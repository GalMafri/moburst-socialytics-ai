// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { coordinatedRivalIqFetch } from '../../../supabase/functions/_shared/competitive/rivaliqConnection';
afterEach(() => vi.unstubAllGlobals());
const provider = 'https://api.rivaliq.com/v3/landscapes';
function environment(run: typeof fetch) {
  vi.stubGlobal('Deno', { env: { get: (name: string) => name === 'SUPABASE_URL' ? 'https://fixture.supabase.co' : 'fixture' } });
  vi.stubGlobal('fetch', run);
}
it('holds the shared lease until the response body is received', async () => {
  const calls: string[] = [];
  environment(vi.fn(async (url: any) => {
    calls.push(String(url));
    if (String(url).endsWith('claim_rivaliq_request')) return Response.json({ acquired: true });
    if (String(url).endsWith('release_rivaliq_request')) return new Response(null, { status: 204 });
    const r = new Response('source evidence');
    const text = r.text.bind(r); r.text = async () => { calls.push('body'); return text(); };
    return r;
  }));
  expect(await (await coordinatedRivalIqFetch(provider)).text()).toBe('source evidence');
  expect(calls.map(v => v.split('/').at(-1))).toEqual(['claim_rivaliq_request', 'landscapes', 'body', 'release_rivaliq_request']);
});
it('does not send a provider request after the shared hourly budget is exhausted', async () => {
  const send = vi.fn(async () => Response.json({ acquired: false, reason: 'hourly_budget', retry_after: 73 }));
  environment(send);
  const response = await coordinatedRivalIqFetch(provider);
  expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('73'); expect(send).toHaveBeenCalledTimes(1);
});
it('retains the lease after an uncertain transport failure', async () => {
  const send = vi.fn(async (url: any) => {
    if (String(url).endsWith('claim_rivaliq_request')) return Response.json({ acquired: true });
    throw new Error('request timed out');
  });
  environment(send);
  await expect(coordinatedRivalIqFetch(provider, { method: 'PUT', body: '{}' })).rejects.toThrow('request timed out');
  expect(send).toHaveBeenCalledTimes(2);
});
it('shares a provider hourly cooldown with every caller', async () => {
  let release: any;
  environment(vi.fn(async (url: any, init: any) => {
    if (String(url).endsWith('claim_rivaliq_request')) return Response.json({ acquired: true });
    if (String(url).endsWith('release_rivaliq_request')) { release = JSON.parse(init.body); return new Response(null, { status: 204 }); }
    return new Response('HourRateLimitExceeded', { status: 429, headers: { 'Retry-After': '81' } });
  }));
  expect((await coordinatedRivalIqFetch(provider)).status).toBe(429); expect(release.cooldown_seconds).toBe(81);
});
it('fails closed if coordination storage is unavailable', async () => {
  const send = vi.fn(async () => new Response('unavailable', { status: 503 })); environment(send);
  await expect(coordinatedRivalIqFetch(provider)).rejects.toThrow('coordinate'); expect(send).toHaveBeenCalledTimes(1);
});
