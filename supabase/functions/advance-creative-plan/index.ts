// The creative run, owned by the server.
//
// A plan (creative_directions) has N frames. For each frame this worker
// submits the design job, collects the provider's result into storage,
// reviews it against the client's references and the approved headline,
// submits one corrected attempt when the review fails, and when every frame
// is approved it creates the design record (post_iterations).
//
// The image model designs the whole post in one picture from the client's own
// published posts (and logo file), with the headline rendered as part of the
// design; nothing is rebuilt in code afterwards. The older paths (a design
// system rendered by render-design; raw artwork finished in the browser) stay
// only for plans that already carry a design_system_id.
//
// It is idempotent and re-entrant: the browser polls it while a dialog is
// open, and a schedule calls it without a browser, so a closed tab never
// loses a paid render.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthzError, requireStaff } from '../_shared/auth/requireStaff.ts';
import { secretEquals } from '../_shared/auth/secretEquals.ts';
import { loadCreativePlan } from '../_shared/design-prompts/loadCreativePlan.ts';
import { frameReferenceIndices } from '../_shared/design-prompts/creativePlan.ts';
import { imageAspectRatio, platformDesignSpec } from '../_shared/design-prompts/aspect.ts';
import { sourceImage } from '../_shared/design-prompts/sourceImage.ts';
import { validateDesignImage, verdictIsDirty } from '../_shared/design-prompts/validateImage.ts';
import { resolveContextImageUrls } from '../_shared/higgsfield/context.ts';
import { startImageWithHiggsfield } from '../_shared/higgsfield/startImage.ts';
import { checkVideoJob } from '../_shared/higgsfield/renderVideo.ts';
import { storeRemoteImage } from '../_shared/media/storeRemote.ts';
import { mediaBackendFor } from '../_shared/higgsfield/backend.ts';
import { artworkCorrection, artworkReviewQuestion, designedHeroPrompt, formatKeyForSpec, loadApprovedSystem, loadSystemById, pickTemplates, templateById, type LoadedSystem } from '../_shared/design-system/load.ts';
import { renderRemote } from '../_shared/design-system/renderClient.ts';
import { artworkQuestionV2, heroPromptV2, isLibraryV2, pickV2, templateV2 } from '../_shared/design-system/v2.ts';
import { FORMAT_DIMENSIONS } from '../_shared/design-system/types.ts';
import { bytesToDataUrl, urlToDataUrl } from '../_shared/render/hero.ts';
import { wholePostCorrection, wholePostExpectedText, wholePostPrompt } from '../_shared/design-prompts/wholePost.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-socialytics-secret' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const MAX_ATTEMPTS = 2; // legacy design-system path
const WHOLE_POST_ATTEMPTS = 3; // a whole post is cheap to redo and a wrong logo or word must never reach a client
const REVIEW_OUTAGES = 3; // review attempts that may fail (service error) before the job itself fails

const REVIEW_IMAGE_LIMIT = 4.5 * 1024 * 1024;
/** The delivered design as review bytes; a file over the reviewer's limit is downsized to the canvas first. */
async function reviewCandidate(db: any, creative: any, job: Job): Promise<string> {
  const res = await fetch(job.output_url!, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`The delivered design could not be fetched for review [${res.status}]`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length <= REVIEW_IMAGE_LIMIT) return bytesToDataUrl(bytes, res.headers.get('content-type') || 'image/png');
  return urlToDataUrl((await preparedHero(db, creative, job)).hero_url);
}

/** An image at a public URL as a reviewer message part, the same shape sourceImage() returns. */
async function imagePartFromUrl(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`The logo file could not be fetched [${res.status}]`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 4 * 1024 * 1024) throw new Error('The logo file is too large to review against.');
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)) as unknown as number[]);
  const mime = (res.headers.get('content-type') || '').split(';')[0] || (/\.png(\?|$)/i.test(url) ? 'image/png' : 'image/jpeg');
  return { type: 'image', source: { type: 'base64', media_type: mime, data: btoa(binary) } };
}
const REVIEWS_PER_TICK = 2;
const STALE_PENDING_MS = 5 * 60 * 1000;

type Job = { id: string; status: string; request_id: string | null; output_url: string | null; error: string | null; review: any; input: any; post_iteration_id: string | null; created_at: string };
type Prepared = { hero_url: string; soft_url: string; width: number; height: number };

/**
 * The hero at canvas size with its soft copy, made once per job by
 * render-design and kept on the job, so the review sends an image under the
 * model's size limit and every render draws same-size images.
 */
async function preparedHero(db: any, creative: any, job: Job): Promise<Prepared> {
  if (job.input?.prepared?.hero_url && job.input?.prepared?.soft_url) return job.input.prepared as Prepared;
  const dims = FORMAT_DIMENSIONS[formatKeyForSpec(platformDesignSpec(creative.platform, creative.format))];
  const prepared = await renderRemote({ kind: 'prepare', client_id: creative.client_id, hero_url: job.output_url, width: dims.width, height: dims.height }) as Prepared;
  const { error } = await db.from('media_jobs').update({ input: { ...job.input, prepared }, updated_at: new Date().toISOString() }).eq('id', job.id);
  if (error) throw new Error('The prepared hero could not be recorded.');
  job.input = { ...job.input, prepared };
  return prepared;
}
type FrameState = { index: number; state: 'rendering' | 'reviewing' | 'approved' | 'failed'; attempt: number; url: string | null; preview: string | null; error: string | null };

async function jobsFor(db: any, clientId: string, planId: string): Promise<Job[]> {
  const { data, error } = await db.from('media_jobs').select('id,status,request_id,output_url,error,review,input,post_iteration_id,created_at').eq('client_id', clientId).contains('input', { creative_plan_id: planId }).order('created_at');
  if (error) throw new Error('The creative jobs could not be read.');
  return data || [];
}

/**
 * The design system this run renders with: the one it was planned with, else
 * the client's approved one, assigned to the plan on the first tick together
 * with a template per frame. A client without an approved system still runs
 * the older path (raw artwork finished in the browser).
 */
async function designSystemFor(db: any, creative: any): Promise<LoadedSystem | null> {
  if (creative.plan.design_system_id) return loadSystemById(db, creative.client_id, creative.plan.design_system_id);
  const approved = await loadApprovedSystem(db, creative.client_id);
  if (!approved) return null;
  const spec = platformDesignSpec(creative.platform, creative.format);
  const { data: recent } = await db.from('creative_directions').select('plan').eq('client_id', creative.client_id).neq('id', creative.id).not('plan->design_system_id', 'is', null).order('created_at', { ascending: false }).limit(2);
  const recentIds = (recent || []).flatMap((r: any) => (r.plan?.frames || []).map((f: any) => f.template_id).filter(Boolean));
  const ids = isLibraryV2(approved.system) ? pickV2(approved.system, formatKeyForSpec(spec), creative.plan, recentIds) : pickTemplates(approved.system, formatKeyForSpec(spec), creative.plan, recentIds);
  const plan = { ...creative.plan, design_system_id: approved.id, frames: creative.plan.frames.map((f: any, i: number) => ({ ...f, template_id: ids[i] })) };
  // Two ticks can reach this together; only the first assignment counts.
  const { data: saved, error } = await db.from('creative_directions').update({ plan }).eq('id', creative.id).is('plan->design_system_id', null).select('plan');
  if (error) throw new Error('The template choice could not be saved.');
  if (saved?.length) creative.plan = plan;
  else { const { data: again } = await db.from('creative_directions').select('plan').eq('id', creative.id).single(); creative.plan = again?.plan || plan; }
  return loadSystemById(db, creative.client_id, creative.plan.design_system_id);
}

/** The client's logo file as a public image URL, when Client Setup has one; otherwise the posts carry the logo. */
async function clientLogoUrl(db: any, clientId: string): Promise<string | null> {
  const { data } = await db.from('clients').select('logo_url').eq('id', clientId).maybeSingle();
  const url = typeof data?.logo_url === 'string' ? data.logo_url.trim() : '';
  return /^https:\/\/.+\.(png|jpe?g|webp)(\?.*)?$/i.test(url) ? url : null;
}

async function submitFrame(db: any, creative: any, index: number, attempt: number, correction: string, designed: LoadedSystem | null): Promise<Job> {
  const key = { creative_plan_id: creative.id, creative_frame_index: index, creative_attempt: attempt };
  const { data: row, error } = await db.from('media_jobs').insert({ client_id: creative.client_id, kind: 'image', provider: 'higgsfield', status: 'pending', input: key }).select('id,status,request_id,output_url,error,review,input,post_iteration_id,created_at').single();
  if (error) {
    if (error.code === '23505') { const { data } = await db.from('media_jobs').select('id,status,request_id,output_url,error,review,input,post_iteration_id,created_at').eq('client_id', creative.client_id).contains('input', key).single(); return data; }
    throw new Error('The image job could not be reserved.');
  }
  try {
    const frame = creative.plan.frames[index];
    const refs = frameReferenceIndices(frame).map((i: number) => creative.reference_paths[i]);
    const { referenceUrls } = await resolveContextImageUrls({ design_references: refs }, db);
    if (referenceUrls.length !== refs.length) throw new Error('The selected client references could not be opened.');
    const spec = platformDesignSpec(creative.platform, creative.format);
    const logoUrl = designed ? null : await clientLogoUrl(db, creative.client_id);
    const prompt = designed
      ? (isLibraryV2(designed.system) ? heroPromptV2(creative.plan, index, templateV2(designed.system, frame.template_id), spec, creative.plan.brand_system || '', correction) : designedHeroPrompt(creative.plan, index, designed.system, templateById(designed.system, frame.template_id), spec, correction))
      : wholePostPrompt(creative.plan, index, spec, creative.mode, Boolean(logoUrl), correction);
    const started = await startImageWithHiggsfield(db, prompt, imageAspectRatio(creative.platform, creative.format), logoUrl ? [...referenceUrls, logoUrl] : referenceUrls);
    const { error: recordError } = await db.from('media_jobs').update({ request_id: started.jobId, model_path: started.model, status: 'submitted', updated_at: new Date().toISOString() }).eq('id', row.id);
    if (recordError) throw new Error(`Image submitted as ${started.jobId} but recording failed.`);
    return { ...row, status: 'submitted', request_id: started.jobId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image submission unavailable';
    await db.from('media_jobs').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', row.id);
    return { ...row, status: 'failed', error: message };
  }
}

async function reviewJob(db: any, creative: any, index: number, job: Job, designed: LoadedSystem | null) {
  const frame = creative.plan.frames[index];
  const references = await Promise.all(frameReferenceIndices(frame).map((i: number) => sourceImage(db, creative.reference_paths[i])));
  // The reviewer judges the logo against the client's logo file when there is one (same message part shape as a reference).
  const logoUrl = designed ? null : await clientLogoUrl(db, creative.client_id);
  if (logoUrl) { try { references.push(await imagePartFromUrl(logoUrl)); } catch { /* the posts still carry the logo */ } }
  const v2 = designed && isLibraryV2(designed.system) ? templateV2(designed.system, frame.template_id) : null;
  const template = designed && !v2 ? templateById(designed.system, frame.template_id) : null;
  const direction = v2 ? JSON.stringify({ subject: frame.subject, hero_slot: v2.hero }) : template ? JSON.stringify({ subject: frame.subject, hero_region: template.hero_region, calm_region: template.headline.region, never: designed!.system.imagery.never })
    : frame.layout ? JSON.stringify({ subject: frame.subject, headline_position: frame.layout.headline_position, subject_position: frame.layout.subject_position }) : undefined;
  // The reviewer takes image bytes, not a URL, and the model caps an image at 5 MB. A whole post is reviewed as delivered
  // (the provider's 2k PNG is about 2 MB); only an oversized file goes through the canvas-size copy. The legacy path keeps
  // using the prepared hero it renders with.
  const candidate = designed ? await urlToDataUrl((await preparedHero(db, creative, job)).hero_url) : await reviewCandidate(db, creative, job);
  // A whole post is judged with its approved words: exact text, one authentic logo, legible, on brand.
  const expectedText = designed ? '' : wholePostExpectedText(creative.plan, index, creative.mode);
  const verdict = await validateDesignImage(candidate, { referenceImages: references, creative: true, video: false, creativeDirection: direction, expectedText, question: v2 ? artworkQuestionV2(v2, frame.subject) : template ? artworkReviewQuestion(designed!.system, template, frame.subject) : undefined });
  const dirty = verdictIsDirty(verdict, { expectNoText: Boolean(designed) });
  if (verdict.skipped && !designed) {
    // A whole post is never approved unreviewed: leave the job awaiting review so the next tick tries again,
    // and give up on the job after three review outages.
    const failures = Number(job.input?.review_failures ?? 0) + 1;
    if (failures >= REVIEW_OUTAGES) {
      await db.from('media_jobs').update({ status: 'failed', error: `The design could not be reviewed: ${verdict.reason || 'review unavailable'}`.slice(0, 1000), input: { ...job.input, review_failures: failures }, updated_at: new Date().toISOString() }).eq('id', job.id);
      return { verdict, dirty: false, skipped: true, failed: true };
    }
    await db.from('media_jobs').update({ input: { ...job.input, review_failures: failures }, updated_at: new Date().toISOString() }).eq('id', job.id);
    return { verdict, dirty: false, skipped: true, failed: false };
  }
  await db.from('media_jobs').update({ review: { ...verdict, dirty }, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id);
  return { verdict, dirty, skipped: false, failed: false };
}

const AGENT_ENGINE = 'creative-agent';
const AGENT_TIMEOUT_MS = 90 * 60 * 1000;

/** The Creative Production agent designs this plan: one queued brief, delivered back through agent-brief. */
async function advanceAgentPlan(db: any, creative: any): Promise<{ frames: FrameState[]; done: boolean; failed: boolean; iterations: Array<{ id: string; media_urls: string[]; frames: number[]; finishing?: string }> }> {
  const count = creative.plan.frames.length;
  const all = creative.plan.frames.map((_: unknown, i: number) => i);
  const { data: existing } = await db.from('media_jobs').select('id,status,error,input,post_iteration_id,created_at').eq('client_id', creative.client_id).eq('provider', AGENT_ENGINE).contains('input', { creative_plan_id: creative.id }).order('created_at', { ascending: false }).limit(1).maybeSingle();
  let job = existing;
  if (!job) {
    const { data, error } = await db.from('media_jobs').insert({ client_id: creative.client_id, kind: 'image', provider: AGENT_ENGINE, status: 'pending', input: { creative_plan_id: creative.id, engine: AGENT_ENGINE, frames: count } }).select('id,status,error,input,post_iteration_id,created_at').single();
    if (error) throw new Error('The agent brief could not be queued.');
    job = data;
  }
  if (job.post_iteration_id) {
    const { data } = await db.from('post_iterations').select('id,media_urls,variant_angle,finishing').eq('client_id', creative.client_id).like('variant_angle', `Reference creative ${creative.id}%`).order('created_at');
    return { frames: all.map((i: number) => ({ index: i, state: 'approved', attempt: 0, url: null, preview: null, error: null })), done: true, failed: false, iterations: (data || []).map((it: any, n: number) => ({ ...it, frames: creative.mode === 'carousel' ? all : [n] })) };
  }
  if (job.status !== 'failed' && Date.now() - Date.parse(job.created_at) > AGENT_TIMEOUT_MS) {
    await db.from('media_jobs').update({ status: 'failed', error: 'The Creative Production agent did not deliver this brief within 90 minutes.', updated_at: new Date().toISOString() }).eq('id', job.id);
    job = { ...job, status: 'failed', error: 'The Creative Production agent did not deliver this brief within 90 minutes.' };
  }
  const delivered = job.input?.delivered || {};
  const frames: FrameState[] = all.map((i: number) => ({ index: i, state: job.status === 'failed' ? 'failed' : delivered[String(i)] ? 'approved' : job.status === 'submitted' ? 'reviewing' : 'rendering', attempt: 0, url: delivered[String(i)] || null, preview: delivered[String(i)] || null, error: job.status === 'failed' ? job.error : null }));
  return { frames, done: false, failed: job.status === 'failed', iterations: [] };
}

async function advancePlan(db: any, creative: any, budget: { reviews: number }): Promise<{ frames: FrameState[]; done: boolean; failed: boolean; iterations: Array<{ id: string; media_urls: string[]; frames: number[]; finishing?: string }> }> {
  if (await mediaBackendFor(db, creative.client_id) === AGENT_ENGINE) return advanceAgentPlan(db, creative);
  const designed = await designSystemFor(db, creative);
  const count = creative.plan.frames.length;
  const jobs = await jobsFor(db, creative.client_id, creative.id);
  const attached = jobs.filter(j => j.post_iteration_id);
  if (attached.length) {
    const ids = [...new Set(attached.map(j => j.post_iteration_id))];
    const { data } = await db.from('post_iterations').select('id,media_urls,variant_angle,finishing').in('id', ids);
    return { frames: creative.plan.frames.map((_: unknown, i: number) => ({ index: i, state: 'approved', attempt: 0, url: null, preview: null, error: null })), done: true, failed: false, iterations: (data || []).map((it: any) => ({ ...it, frames: creative.mode === 'carousel' ? creative.plan.frames.map((_: unknown, i: number) => i) : [creative.plan.frames.findIndex((f: any) => String(it.variant_angle || '').endsWith(f.subject.slice(0, 80)))].map(i => Math.max(0, i)) })) };
  }
  const frames: FrameState[] = [];
  const jobByIndex = new Map<number, Job>();
  for (let index = 0; index < count; index++) {
    const mine = jobs.filter(j => j.input?.creative_frame_index === index).sort((a, b) => (a.input?.creative_attempt ?? 0) - (b.input?.creative_attempt ?? 0));
    let job = mine[mine.length - 1];
    let attempt = job ? Number(job.input?.creative_attempt ?? 0) : 0;
    if (!job) { job = await submitFrame(db, creative, index, 0, '', designed); }
    if (job.status === 'pending' && Date.now() - Date.parse(job.created_at) > STALE_PENDING_MS) {
      await db.from('media_jobs').update({ status: 'failed', error: 'The submission did not complete.', updated_at: new Date().toISOString() }).eq('id', job.id);
      job = { ...job, status: 'failed', error: 'The submission did not complete.' };
    }
    if (job.status === 'submitted' && job.request_id) {
      try {
        const snapshot = await checkVideoJob(db, job.request_id);
        if (snapshot.status === 'completed' && snapshot.url) {
          const stored = await storeRemoteImage(db, creative.client_id, snapshot.url, `creative-${creative.id}-${index}-${attempt}`);
          await db.from('media_jobs').update({ status: 'completed', output_url: stored, updated_at: new Date().toISOString() }).eq('id', job.id);
          job = { ...job, status: 'completed', output_url: stored };
        } else if (snapshot.status === 'failed') {
          await db.from('media_jobs').update({ status: 'failed', error: snapshot.error, updated_at: new Date().toISOString() }).eq('id', job.id);
          job = { ...job, status: 'failed', error: snapshot.error };
        }
      } catch (err) {
        // A lookup failure is not evidence about the render; try again next tick.
        console.warn('[advance-creative-plan] provider check failed:', err instanceof Error ? err.message : err);
      }
    }
    if (job.status === 'completed' && job.output_url && !job.review && budget.reviews > 0) {
      budget.reviews--;
      const reviewed = await reviewJob(db, creative, index, job, designed);
      const { verdict, dirty } = reviewed;
      if (reviewed.failed) job = { ...job, status: 'failed', error: `The design could not be reviewed: ${verdict.reason || 'review unavailable'}` };
      else if (!reviewed.skipped) job = { ...job, review: { ...verdict, dirty } };
      if (dirty) {
        const reason = designed ? artworkCorrection(verdict) : wholePostCorrection(verdict, wholePostExpectedText(creative.plan, index, creative.mode));
        if (attempt + 1 < (designed ? MAX_ATTEMPTS : WHOLE_POST_ATTEMPTS)) { job = await submitFrame(db, creative, index, attempt + 1, reason, designed); attempt += 1; }
        else { await db.from('media_jobs').update({ status: 'failed', error: `Brand review rejected the artwork: ${reason}`.slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', job.id); job = { ...job, status: 'failed', error: `Brand review rejected the artwork: ${reason}` }; }
      }
    }
    const approved = job.status === 'completed' && job.review && !job.review.dirty;
    const state: FrameState['state'] = approved ? 'approved' : job.status === 'failed' ? 'failed' : job.status === 'completed' ? 'reviewing' : 'rendering';
    frames.push({ index, state, attempt, url: approved ? job.output_url : null, preview: job.output_url || null, error: job.status === 'failed' ? job.error : null });
    jobByIndex.set(index, job);
  }
  const failed = frames.some(f => f.state === 'failed');
  const done = !failed && frames.every(f => f.state === 'approved');
  const iterations: Array<{ id: string; media_urls: string[]; frames: number[]; finishing?: string }> = [];
  if (done) {
    // A whole-post design is finished as delivered. With a legacy design
    // system the still is rendered here from the template and the approved hero.
    const finalUrl = new Map<number, string>(frames.map(f => [f.index, f.url!]));
    if (designed) {
      const rendered = await Promise.all(frames.map(async f => {
        const prepared = await preparedHero(db, creative, jobByIndex.get(f.index)!);
        return renderRemote({ kind: 'frame', client_id: creative.client_id, plan_id: creative.id, frame_index: f.index, hero_url: prepared.hero_url, soft_url: prepared.soft_url });
      }));
      for (const r of rendered) finalUrl.set(r.index, r.url);
    }
    const base = { client_id: creative.client_id, platform: creative.platform || null, post_copy: creative.post_copy || null, format: creative.format || null, source: 'calendar', finishing: 'done', variant_group_id: crypto.randomUUID() };
    const rows = creative.mode === 'carousel'
      ? [{ ...base, media_urls: frames.map(f => finalUrl.get(f.index)!), variant_angle: `Reference creative ${creative.id}`, is_selected: true, frames: frames.map(f => f.index) }]
      : frames.map(f => ({ ...base, media_urls: [finalUrl.get(f.index)!], variant_angle: `Reference creative ${creative.id}: ${creative.plan.frames[f.index].subject}`.slice(0, 500), is_selected: false, frames: [f.index] }));
    for (const row of rows) {
      const { frames: owned, ...insert } = row;
      let { data, error } = await db.from('post_iterations').insert(insert).select('id,media_urls,finishing').single();
      if (error?.code === '23505') ({ data, error } = await db.from('post_iterations').select('id,media_urls,finishing').eq('client_id', creative.client_id).eq('variant_angle', insert.variant_angle).single());
      if (error || !data) throw new Error('The design record could not be created.');
      iterations.push({ ...data, frames: owned });
      for (const index of owned) await db.from('media_jobs').update({ post_iteration_id: data.id }).eq('client_id', creative.client_id).contains('input', { creative_plan_id: creative.id, creative_frame_index: index });
    }
  }
  return { frames, done, failed, iterations };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const scheduled = await secretEquals(req.headers.get('x-socialytics-secret'), Deno.env.get('SOCIALYTICS_N8N_SECRET'));
    const budget = { reviews: REVIEWS_PER_TICK };
    if (body.plan_id) {
      const clientId = String(body.client_id || '');
      if (!clientId) return json({ error: 'client_id is required' }, 400);
      if (!scheduled) await requireStaff(req, { writeClientId: clientId });
      const creative = await loadCreativePlan(db, body.plan_id, clientId);
      if (creative.mode === 'video') return json({ error: 'Video runs are collected by the video dialog.' }, 400);
      const result = await advancePlan(db, creative, budget);
      return json({ plan_id: creative.id, mode: creative.mode, count: creative.plan.frames.length, ...result });
    }
    if (!scheduled) return json({ error: 'unauthorized' }, 401);
    // Sweep: every plan with an open still job from the last six hours.
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: open } = await db.from('media_jobs').select('client_id,input').eq('kind', 'image').is('post_iteration_id', null).in('status', ['pending', 'submitted', 'completed']).gte('created_at', since).limit(200);
    const plans = new Map<string, string>();
    for (const j of open || []) if (j.input?.creative_plan_id) plans.set(j.input.creative_plan_id, j.client_id);
    const swept: Array<{ plan_id: string; done: boolean; failed: boolean; error?: string }> = [];
    for (const [planId, clientId] of [...plans.entries()].slice(0, 4)) {
      try {
        const creative = await loadCreativePlan(db, planId, clientId);
        if (creative.mode === 'video') continue;
        const result = await advancePlan(db, creative, budget);
        swept.push({ plan_id: planId, done: result.done, failed: result.failed });
      } catch (err) { swept.push({ plan_id: planId, done: false, failed: false, error: err instanceof Error ? err.message : String(err) }); }
    }
    return json({ swept });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    return json({ error: err instanceof Error ? err.message : 'The creative run could not be advanced.' }, 500);
  }
});
