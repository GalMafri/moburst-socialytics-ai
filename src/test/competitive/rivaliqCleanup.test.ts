import { describe, it, expect } from 'vitest';
import { cleanupRivalIqLandscape, type SetupJob } from '../../../supabase/functions/_shared/competitive/rivaliqSetup';

const plan = { set_id: 'set-1', client_id: 'c-1', name: 'Socialytics - Brooklinen - set-1', companies: [{ id: 'c-1', name: 'Brooklinen', url: 'https://brooklinen.com/' }] };
const job = (over: Partial<SetupJob> = {}): SetupJob => ({ phase: 'following_failed', landscape_id: '654991', operation_token: 't', plan, ...over });

function fakeApi(world: { landscape?: { id: string; name: string } | null; companies?: unknown[] }) {
  const calls: Array<[string, string]> = [];
  const api = async (path: string, method = 'GET') => {
    calls.push([method, path]);
    if (method === 'DELETE') return {};
    if (path === '/landscapes/654991') return { landscape: world.landscape === undefined ? { id: '654991', name: plan.name } : world.landscape };
    if (path === '/landscapes/654991/companies') return { companies: world.companies ?? [] };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { api, calls };
}

describe('cleanupRivalIqLandscape', () => {
  it('deletes a landscape this setup created when it tracks no company', async () => {
    const { api, calls } = fakeApi({});
    expect(await cleanupRivalIqLandscape(job(), api)).toEqual({ deleted: true, reason: 'empty' });
    expect(calls).toEqual([['GET', '/landscapes/654991'], ['GET', '/landscapes/654991/companies'], ['DELETE', '/landscapes/654991']]);
  });
  it('never deletes a landscape that still tracks companies, one it did not create, or nothing at all', async () => {
    const busy = fakeApi({ companies: [{ id: 1 }] });
    expect(await cleanupRivalIqLandscape(job(), busy.api)).toEqual({ deleted: false, reason: 'has_companies' });
    expect(busy.calls.some(([m]) => m === 'DELETE')).toBe(false);
    const foreign = fakeApi({ landscape: { id: '654991', name: 'TIER 1 Competitors' } });
    expect(await cleanupRivalIqLandscape(job(), foreign.api)).toEqual({ deleted: false, reason: 'not_ours' });
    expect(foreign.calls).toEqual([['GET', '/landscapes/654991']]);
    const gone = fakeApi({ landscape: null });
    expect(await cleanupRivalIqLandscape(job(), gone.api)).toEqual({ deleted: false, reason: 'not_found' });
    const none = fakeApi({});
    expect(await cleanupRivalIqLandscape(job({ landscape_id: null }), none.api)).toEqual({ deleted: false, reason: 'no_landscape' });
    expect(none.calls).toEqual([]);
  });
});
