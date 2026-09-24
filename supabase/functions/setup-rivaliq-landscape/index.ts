import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireStaff, AuthzError } from '../_shared/auth/requireStaff.ts';
import { advanceRivalIqSetup, publicCompanyUrl, type SetupPlan } from '../_shared/competitive/rivaliqSetup.ts';
import { rivalIqFetch } from '../_shared/competitive/rivaliqFetch.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
async function fingerprint(plan: SetupPlan) {
 const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(plan)));
 return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
Deno.serve(async req => {
 if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
 if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
 let db: any, leaseId: string | undefined, setId: string | undefined;
 try {
  const body = await req.json();
  if (!body.set_id || !['preview', 'advance'].includes(body.mode)) return json({ error: 'set_id and mode are required' }, 400);
  const { asCaller } = await requireStaff(req);
  db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  setId = body.set_id;
  const { data: set, error: se } = await db.from('competitor_sets').select('id,client_id,status').eq('id', setId).maybeSingle();
  if (se) throw se;
  if (!set) return json({ error: 'Competitor set not found' }, 404);
  const { data: allowed, error: ae } = await asCaller.rpc('can_write_client', { _client_id: set.client_id });
  if (ae) throw ae;
  if (!allowed) return json({ error: 'You do not have access to this client' }, 403);
  if (!['confirmed', 'complete', 'failed'].includes(set.status)) return json({ error: 'Confirm the competitor set first and wait for any active analysis to finish.' }, 409);
  const makePlan = async (): Promise<SetupPlan> => {
   const { data: client, error: ce } = await db.from('clients').select('id,name,website_url,archived_at').eq('id', set.client_id).single();
   if (ce) throw ce;
   if (client.archived_at) throw new Error('Archived clients cannot start provider tracking.');
   const { data: selected, error: pe } = await db.from('competitors').select('id,name,website_url,selected_rank').eq('set_id', setId).eq('is_selected', true).order('selected_rank');
   if (pe) throw pe;
   if (selected?.length !== 3 || selected.some((c: any, i: number) => c.selected_rank !== i + 1)) throw new Error('Select and rank exactly three competitors first.');
   const companies = [client, ...selected].map((c: any) => ({ id: c.id, name: c.name, url: publicCompanyUrl(c.website_url) }));
   if (new Set(companies.map((c: any) => c.url)).size !== 4) throw new Error('The client and three competitors must have distinct public websites.');
   return { set_id: set.id, client_id: set.client_id, name: `Socialytics - ${client.name.slice(0, 40)} - ${set.id}`, companies };
  };
  const plan = await makePlan();
  const hash = await fingerprint(plan);
  const { data: prior, error: je } = await db.from('rivaliq_setup_jobs').select('*').eq('set_id', setId).maybeSingle();
  if (je) throw je;
  const publicJob = (job: any) => job ? { phase: job.phase, landscape_id: job.landscape_id } : null;
  if (prior && prior.fingerprint !== hash) return json({ error: 'This setup belongs to an earlier selection. Create and confirm a new competitor draft before connecting different companies.' }, 409);
  if (body.mode === 'preview') return json({ plan, fingerprint: hash, job: publicJob(prior) });
  if (body.fingerprint !== hash || (prior && prior.fingerprint !== hash)) return json({ error: 'The reviewed company list changed. Review setup again before continuing.' }, 409);
  const key = Deno.env.get('RIVALIQ_API_KEY');
  if (!key) return json({ error: 'RivalIQ API key is not configured.' }, 503);
  if (!prior) {
   const { error } = await db.from('rivaliq_setup_jobs').upsert({ set_id: setId, client_id: set.client_id, plan, fingerprint: hash }, { onConflict: 'set_id', ignoreDuplicates: true });
   if (error) throw error;
  }
  leaseId = crypto.randomUUID();
  const now = new Date();
  const { data: job, error: le } = await db.from('rivaliq_setup_jobs')
   .update({ lease_id: leaseId, lease_until: new Date(now.getTime() + 120000).toISOString() })
   .eq('set_id', setId).eq('fingerprint', hash)
   .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select('*').maybeSingle();
  if (le) throw le;
  if (!job) return json({ error: 'Setup is already being checked. Wait two minutes before checking again.' }, 409);
  const save = async (patch: any) => {
   const { data, error } = await db.from('rivaliq_setup_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('set_id', setId).eq('lease_id', leaseId).select('set_id').maybeSingle();
   if (error || !data) throw new Error('Could not save setup progress. Check its status before trying again.');
  };
  const api = async (path: string, method = 'GET', payload?: unknown) => {
   const response = await rivalIqFetch(`https://api.rivaliq.com/v3${path}?apiKey=${encodeURIComponent(key)}`, {
    method, headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(25000),
   });
   if (!response.ok) throw new Error(`RivalIQ returned HTTP ${response.status}. Check API permissions or account capacity, then check setup status. No automatic POST retry was sent.`);
   // Provider validation messages can contain request URLs. Remove the key
   // before any message can reach a caller or logs; operation tokens stay server-side.
   return JSON.parse(JSON.stringify(await response.json(), (_name, value) => typeof value === 'string'
    ? value.replaceAll(key, '[redacted]').replaceAll(encodeURIComponent(key), '[redacted]') : value));
  };
  const next = await advanceRivalIqSetup(job, api, save);
  if (next.phase === 'verified') {
   // Do not link a plan that was edited while the provider request was running.
   if (await fingerprint(await makePlan()) !== hash) throw new Error('Selection changed during setup. Tracking was preserved but not linked.');
   const { data: linked, error } = await db.from('competitor_sets').update({ rivaliq_landscape_id: next.landscape_id })
    .eq('id', setId).in('status', ['confirmed', 'complete', 'failed']).select('id').maybeSingle();
   if (error || !linked) throw new Error('Tracking is verified, but the set changed or is analyzing. Check setup again once it is ready.');
   await save({ phase: 'complete' });
   next.phase = 'complete';
  }
  return json({ job: publicJob(next), message: next.phase === 'complete' ? 'Tracking verified and linked. Historical data availability depends on RivalIQ.' : 'Progress saved. Check status to continue.' });
 } catch (e) {
  return json({ error: e instanceof Error ? e.message : 'Setup failed' }, e instanceof AuthzError ? e.status : 422);
 } finally {
  if (db && leaseId && setId) await db.from('rivaliq_setup_jobs').update({ lease_id: null, lease_until: null }).eq('set_id', setId).eq('lease_id', leaseId);
 }
});
