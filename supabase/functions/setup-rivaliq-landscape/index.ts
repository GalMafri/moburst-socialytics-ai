// RivalIQ tracking for a confirmed competitor set, one step per call, for the
// Competitors screen. The plan, the lease, the API and linking live in
// _shared/competitive/rivaliqSetupRun.ts, which the client lifecycle's
// tracking step uses to run the same setup on the server until it is done.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireStaff, AuthzError } from '../_shared/auth/requireStaff.ts';
import { advanceRivalIqSetup, cleanupRivalIqLandscape } from '../_shared/competitive/rivaliqSetup.ts';
import { leaseSetupJob, linkVerified, planFingerprint, rivalIqApi, SetupError, setupPlan } from '../_shared/competitive/rivaliqSetupRun.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
 if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
 if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
 let release: (() => Promise<void>) | null = null;
 try {
  const body = await req.json();
  if (!body.set_id || !['preview', 'advance', 'cleanup'].includes(body.mode)) return json({ error: 'set_id and mode are required' }, 400);
  const caller = await requireStaff(req);
  const { asCaller } = caller;
  // deno-lint-ignore no-explicit-any
  const db: any = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const setId: string = body.set_id;
  const { data: set, error: se } = await db.from('competitor_sets').select('id,client_id,status').eq('id', setId).maybeSingle();
  if (se) throw se;
  if (!set) return json({ error: 'Competitor set not found' }, 404);
  // The project's own server calls are trusted for every client.
  const { data: allowed, error: ae } = caller.viaSecret ? { data: true, error: null } : await asCaller.rpc('can_write_client', { _client_id: set.client_id });
  if (ae) throw ae;
  if (!allowed) return json({ error: 'You do not have access to this client' }, 403);
  if (!['confirmed', 'complete', 'failed'].includes(set.status)) return json({ error: 'Confirm the competitor set first and wait for any active analysis to finish.' }, 409);
  const plan = await setupPlan(db, setId);
  const hash = await planFingerprint(plan);
  const { data: prior, error: je } = await db.from('rivaliq_setup_jobs').select('*').eq('set_id', setId).maybeSingle();
  if (je) throw je;
  // deno-lint-ignore no-explicit-any
  const publicJob = (job: any) => job ? { phase: job.phase, landscape_id: job.landscape_id } : null;
  if (prior && prior.fingerprint !== hash) return json({ error: 'This setup belongs to an earlier selection. Create and confirm a new competitor draft before connecting different companies.' }, 409);
  if (body.mode === 'preview') return json({ plan, fingerprint: hash, job: publicJob(prior) });
  if (body.mode === 'cleanup') {
   // Removing an empty landscape left by a failed follow. Nothing to clean without a setup record.
   if (!prior) return json({ error: 'No tracking setup exists for this set.' }, 404);
  } else if (body.fingerprint !== hash) return json({ error: 'The reviewed company list changed. Review setup again before continuing.' }, 409);
  const key = Deno.env.get('RIVALIQ_API_KEY');
  if (!key) return json({ error: 'RivalIQ API key is not configured.' }, 503);
  const leased = await leaseSetupJob(db, plan, hash);
  if (!leased) return json({ error: 'Setup is already being checked. Wait two minutes before checking again.' }, 409);
  release = leased.release;
  const api = rivalIqApi(key);
  if (body.mode === 'cleanup') {
   // A landscape already removed on the provider's side leaves only our stale record to clear.
   const cleanup = await cleanupRivalIqLandscape(leased.job, api).catch((e: unknown) => {
    if (e instanceof Error && /HTTP 404/.test(e.message)) return { deleted: false, reason: 'not_found' as const };
    throw e;
   });
   if (cleanup.deleted || cleanup.reason === 'not_found') {
    const { error: ue } = await db.from('competitor_sets').update({ rivaliq_landscape_id: null }).eq('id', setId).eq('rivaliq_landscape_id', leased.job.landscape_id);
    if (ue) throw ue;
    const { error: de } = await db.from('rivaliq_setup_jobs').delete().eq('set_id', setId).eq('lease_id', leased.leaseId);
    if (de) throw de;
    release = null;
   }
   return json({ cleanup, job: cleanup.deleted ? null : publicJob(leased.job) });
  }
  const next = await advanceRivalIqSetup(leased.job, api, leased.save);
  if (next.phase === 'verified') {
   await linkVerified(db, plan, hash, String(next.landscape_id));
   await leased.save({ phase: 'complete' });
   next.phase = 'complete';
  }
  return json({ job: publicJob(next), message: next.phase === 'complete' ? 'Tracking verified and linked. Historical data availability depends on RivalIQ.' : 'Progress saved. Check status to continue.' });
 } catch (e) {
  const status = e instanceof AuthzError ? e.status : e instanceof SetupError ? e.status : 422;
  return json({ error: e instanceof Error ? e.message : 'Setup failed' }, status);
 } finally {
  if (release) await release();
 }
});
