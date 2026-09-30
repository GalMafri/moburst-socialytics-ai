// The machine door for the Creative Production agent.
//
// Socialytics queues an organic brief per creative plan when the client's
// media backend is the agent. The agent's worker pulls the next brief from
// here, designs it, and delivers the finished PNGs back through the same
// door. Nothing on the agent's machine is exposed; it only calls out.
//
// Auth: x-agent-key must equal SOCIALYTICS_AGENT_KEY. Every op is scoped to
// the job the key claimed, and delivery writes only through the job's plan.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { secretEquals } from '../_shared/auth/secretEquals.ts';
import { loadCreativePlan } from '../_shared/design-prompts/loadCreativePlan.ts';
import { platformDesignSpec } from '../_shared/design-prompts/aspect.ts';
import { storeRemoteImage } from '../_shared/media/storeRemote.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-key' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const ENGINE = 'creative-agent';

async function signed(db: any, bucket: string, path: string, seconds = 3600): Promise<string> {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new Error(`Could not sign ${path}`);
  return data.signedUrl;
}

async function packageFor(db: any, job: any) {
  const creative = await loadCreativePlan(db, job.input?.creative_plan_id, job.client_id);
  const { data: client } = await db.from('clients').select('id,name,website_url,brand_identity,logo_url,harvested_design_references,design_style_synthesis').eq('id', job.client_id).single();
  const references = await Promise.all((creative.reference_paths || []).map(async (p: string, i: number) => ({ index: i, path: p, url: await signed(db, 'design-references', p) })));
  const harvested = (client?.harvested_design_references || []).map((h: any) => ({ platform: h.platform, posted_at: h.posted_at, source_url: h.source_url, path: h.path, classification: h.classification }));
  const spec = platformDesignSpec(creative.platform, creative.format);
  return {
    job_id: job.id, run_id: job.request_id || null, plan_id: creative.id, mode: creative.mode,
    client: { id: client.id, name: client.name, website_url: client.website_url || null, font_family: client.brand_identity?.font_family || null, brand_identity: client.brand_identity || null, logo_url: client.logo_url || null },
    post: { copy: creative.post_copy, platform: creative.platform, format: creative.format },
    platform_spec: spec,
    plan: creative.plan,
    references, harvested,
    design_style_synthesis: client?.design_style_synthesis || null,
    delivery: { frames: creative.plan.frames.length, note: 'Deliver one finished PNG per frame index with op=deliver; the app records the design when every frame is delivered.' },
  };
}

async function recordDesign(db: any, job: any) {
  const creative = await loadCreativePlan(db, job.input?.creative_plan_id, job.client_id);
  const delivered: Record<string, string> = job.input?.delivered || {};
  const count = creative.plan.frames.length;
  const urls: string[] = [];
  for (let i = 0; i < count; i++) { if (!delivered[String(i)]) return null; urls.push(delivered[String(i)]); }
  const base = { client_id: job.client_id, platform: creative.platform || null, post_copy: creative.post_copy || null, format: creative.format || null, source: 'calendar', finishing: 'done', variant_group_id: crypto.randomUUID() };
  const rows = creative.mode === 'carousel'
    ? [{ ...base, media_urls: urls, variant_angle: `Reference creative ${creative.id}`, is_selected: true }]
    : urls.map((u, i) => ({ ...base, media_urls: [u], variant_angle: `Reference creative ${creative.id}: ${creative.plan.frames[i].subject}`.slice(0, 500), is_selected: false }));
  const ids: string[] = [];
  for (const row of rows) {
    let { data, error } = await db.from('post_iterations').insert(row).select('id').single();
    if (error?.code === '23505') ({ data, error } = await db.from('post_iterations').select('id').eq('client_id', job.client_id).eq('variant_angle', row.variant_angle).single());
    if (error || !data) throw new Error('The design record could not be created.');
    ids.push(data.id);
  }
  await db.from('media_jobs').update({ status: 'completed', post_iteration_id: ids[0], output_url: urls[0], updated_at: new Date().toISOString() }).eq('id', job.id);
  return ids;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    if (!await secretEquals(req.headers.get('x-agent-key'), Deno.env.get('SOCIALYTICS_AGENT_KEY'))) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const op = String(body.op || 'next');
    if (op === 'next') {
      // Claim the oldest queued brief. The update is conditional on status so two workers cannot claim the same one.
      const { data: queued } = await db.from('media_jobs').select('id,client_id,input,request_id,created_at').eq('provider', ENGINE).eq('status', 'pending').is('post_iteration_id', null).order('created_at').limit(1).maybeSingle();
      if (!queued) return json({ job: null });
      const runId = String(body.run_id || '');
      const { data: claimed } = await db.from('media_jobs').update({ status: 'submitted', request_id: runId || `agent-${queued.id}`, updated_at: new Date().toISOString() }).eq('id', queued.id).eq('status', 'pending').select('id,client_id,input,request_id').maybeSingle();
      if (!claimed) return json({ job: null });
      return json({ job: await packageFor(db, claimed) });
    }
    const jobId = String(body.job_id || '');
    if (!jobId) return json({ error: 'job_id is required' }, 400);
    const { data: job } = await db.from('media_jobs').select('id,client_id,input,request_id,status,post_iteration_id').eq('id', jobId).eq('provider', ENGINE).maybeSingle();
    if (!job) return json({ error: 'unknown job' }, 404);
    if (op === 'package') return json({ job: await packageFor(db, job) });
    if (op === 'deliver') {
      const index = Number(body.frame_index);
      if (!Number.isInteger(index) || index < 0) return json({ error: 'frame_index is required' }, 400);
      let url: string;
      if (typeof body.image_base64 === 'string' && body.image_base64) {
        const bytes = Uint8Array.from(atob(body.image_base64.replace(/^data:[^,]+,/, '')), c => c.charCodeAt(0));
        const path = `${job.client_id}/${Date.now()}-agent-${job.input?.creative_plan_id}-${index}.png`;
        const { error } = await db.storage.from('generated-media').upload(path, new Blob([bytes], { type: 'image/png' }), { contentType: 'image/png', upsert: false });
        if (error) throw new Error(`The delivered image could not be stored: ${error.message}`);
        url = db.storage.from('generated-media').getPublicUrl(path).data.publicUrl;
      } else if (typeof body.image_url === 'string' && body.image_url) {
        url = await storeRemoteImage(db, job.client_id, body.image_url, `agent-${job.input?.creative_plan_id}-${index}`);
      } else return json({ error: 'image_base64 or image_url is required' }, 400);
      const input = { ...job.input, delivered: { ...(job.input?.delivered || {}), [String(index)]: url }, qa: { ...(job.input?.qa || {}), [String(index)]: body.qa || null } };
      await db.from('media_jobs').update({ input, updated_at: new Date().toISOString() }).eq('id', job.id);
      const ids = await recordDesign(db, { ...job, input });
      return json({ stored: url, complete: !!ids, iteration_ids: ids || [] });
    }
    if (op === 'fail') {
      await db.from('media_jobs').update({ status: 'failed', error: String(body.reason || 'The agent could not complete this brief.').slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', job.id);
      return json({ failed: true });
    }
    return json({ error: 'unknown op' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'agent-brief failed' }, 500);
  }
});
