import { describe, it, expect } from 'vitest';
import { advanceRivalIqSetup, matchSetupCompanies, publicCompanyUrl, type SetupJob, type SetupPlan } from '../../../supabase/functions/_shared/competitive/rivaliqSetup';
const plan: SetupPlan = { set_id: 'set', client_id: 'client', name: 'Socialytics - Fixture - set', companies: ['client', 'one', 'two', 'three'].map(id => ({ id, name: id, url: `https://${id}.com/` })) };
const companies = plan.companies.map((c, i) => ({ id: i + 1, url: c.url }));
function fixture(phase = 'ready') {
 const persisted: SetupJob = { phase, plan, landscape_id: phase === 'ready' ? null : '42' };
 const calls: { path: string; method: string; body?: any }[] = [];
 const save = async (patch: Partial<SetupJob>) => { Object.assign(persisted, patch); };
 const api = async (path: string, method = 'GET', body?: unknown) => {
  calls.push({ path, method, body });
  if (method === 'POST' && path === '/landscapes') return { landscape: { id: 42 } };
  if (method === 'POST') return { token: 'operation' };
  if (path.includes('pendingOperations')) return { status: 2 };
  if (path.endsWith('/companies')) return { companies };
  return { landscapes: [] };
 };
 return { persisted, calls, save, api, step: () => advanceRivalIqSetup(structuredClone(persisted), api, save) };
}
describe('RivalIQ API-only setup', () => {
 it('creates once, follows reviewed URLs once, verifies before completion', async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) await f.step();
  expect(f.persisted.phase).toBe('verified');
  expect(f.calls.filter(c => c.method === 'POST')).toEqual([
   { path: '/landscapes', method: 'POST', body: { name: plan.name } },
   { path: '/landscapes/42/companies/byUrl', method: 'POST', body: { companyUrls: plan.companies.map(c => c.url) } },
  ]);
 });
 it('does not dispatch when saving the pre-request journal fails', async () => {
  const f = fixture();
  await expect(advanceRivalIqSetup(f.persisted, f.api, async () => { throw Error('Database unavailable'); })).rejects.toThrow();
  expect(f.calls.every(c => c.method === 'GET')).toBe(true);
 });
 it('reconciles lost create responses without another POST', async () => {
  const f = fixture();
  await expect(advanceRivalIqSetup(structuredClone(f.persisted), async (p, m) => {
   if (m === 'POST') throw Error('Response lost');
   return { landscapes: [] };
  }, f.save)).rejects.toThrow('Response lost');
  expect(f.persisted.phase).toBe('create_requested');
  await advanceRivalIqSetup(structuredClone(f.persisted), async (p, m = 'GET') => {
   expect(m).toBe('GET'); return { landscapes: [{ id: 42, name: plan.name }] };
  }, f.save);
  expect(f.persisted.phase).toBe('created');
 });
 it('does not repeat an uncertain creation when reconciliation finds nothing', async () => {
  const f = fixture('create_requested');
  await expect(f.step()).rejects.toThrow('uncertain');
  expect(f.calls.every(c => c.method === 'GET')).toBe(true);
 });
 it('does not repeat a lost company-follow POST', async () => {
  const f = fixture('created');
  await expect(advanceRivalIqSetup(structuredClone(f.persisted), async () => { throw Error('Response lost'); }, f.save)).rejects.toThrow();
  expect(f.persisted.phase).toBe('follow_requested');
  await f.step();
  expect(f.persisted.phase).toBe('verified');
  expect(f.calls.every(c => c.method === 'GET')).toBe(true);
 });
 it('keeps pending provider operations pending', async () => {
  const f = fixture('following');
  await advanceRivalIqSetup(structuredClone(f.persisted), async () => ({ status: 1 }), f.save);
  expect(f.persisted.phase).toBe('following');
 });
 it('rejects partial follow failures, even with overall success', async () => {
  const f = fixture('following');
  await expect(advanceRivalIqSetup(f.persisted, async () => ({ status: 2, urls: { a: { status: 3 } } }), f.save)).rejects.toThrow('every reviewed website');
  expect(f.persisted.phase).toBe('following');
 });
 it('does not link incomplete companies', async () => {
  const f = fixture('verify');
  await expect(advanceRivalIqSetup(f.persisted, async () => ({ companies: companies.slice(1) }), f.save)).rejects.toThrow('Nothing was linked');
  expect(f.persisted.phase).toBe('verify');
 });
 it('identifies the failed reviewed company and provider reason', async () => {
  const f = fixture('following');
  await expect(advanceRivalIqSetup(f.persisted, async () => ({ status: 3, urls: {
   'http://www.one.com/': {status:3,error:'Company allowance reached'},
   'https://client.com/': {status:2,companyId:1},
  } }), f.save)).rejects.toThrow('one: Company allowance reached');
  expect(f.persisted.phase).toBe('following');
 });
 it('reuses an exact existing set without provider writes', async () => {
  const f = fixture();
  await advanceRivalIqSetup(f.persisted, async (p, m = 'GET') => {
   expect(m).toBe('GET'); return { landscapes: [{ id: 77, companies }] };
  }, f.save);
  expect(f.persisted.phase).toBe('verify'); expect(f.persisted.landscape_id).toBe('77');
 });
 it('does not create a duplicate when multiple existing landscapes match', async () => {
  const f = fixture();
  await expect(advanceRivalIqSetup(f.persisted, async (p, m = 'GET') => {
   expect(m).toBe('GET'); return { landscapes: [{id:1,companies},{id:2,companies}] };
  }, f.save)).rejects.toThrow('Several existing landscapes');
  expect(f.persisted.phase).toBe('ready');
 });
 it('does not repurpose a landscape that includes unreviewed companies', async () => {
  const f = fixture();
  await advanceRivalIqSetup(f.persisted, async (p, m, b) => m === 'POST' ? f.api(p,m,b) : { landscapes: [{ id: 77, companies: [...companies,{id:90,url:'https://unreviewed.com/'}] }] }, f.save);
  expect(f.persisted.landscape_id).toBe('42');
 });
 it('rejects ambiguous website matches', () => {
  expect(matchSetupCompanies(plan, [...companies, { id: 9, url: 'https://client.com/' }])).toBeNull();
 });
 it('normalizes bare domains and www aliases', () => {
  expect(publicCompanyUrl('Moburst.com')).toBe('https://moburst.com/');
  expect(publicCompanyUrl('http://www.moburst.com/about')).toBe('https://moburst.com/');
 });
 it.each(['https://nd-main-qa.moburst.org/', 'https://staging.example.com', 'http://127.0.0.1', 'https://user:pass@example.com', 'https://instagram.com/example', '', 'https://example.com:3000'])('rejects unsafe or inappropriate identity %s', url => {
  expect(() => publicCompanyUrl(url)).toThrow();
 });
});
