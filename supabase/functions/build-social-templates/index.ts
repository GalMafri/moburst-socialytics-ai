// Build a client's social template library from its own published posts, one
// unit of work per call so the panel (or an operator) can drive it to the end:
//   step  -> read the next post (round 0), or refine the current read with the
//            heatmap, or keep the best read as a template once it is close
//            enough (or three rounds are spent); then match the faces.
//   get   -> the build state and the library so far.
//   approve -> mark the finished library as the client's system (v2).
// Nothing here decides a layout: every template is a post the renderer has
// reproduced, scored against the original; the reproduction is its preview.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthzError, requireStaff } from '../_shared/auth/requireStaff.ts';
import { secretEquals } from '../_shared/auth/secretEquals.ts';
import { referencesFor } from '../_shared/design-prompts/designRefs.ts';
import { readRemote } from '../_shared/design-system/readClient.ts';
import { templateFromRead, type Template } from '../_shared/design-system/template.ts';
import { palette } from '../_shared/design-system/palette.ts';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-socialytics-secret', 'Content-Type': 'application/json' };
const KEEP_SCORE = 0.62; const MAX_ROUNDS = 3; const MAX_POSTS = 8;

type Build = {
  queue: string[];
  current: null | { path: string; round: number; layers: any[]; render_url: string; heatmap_url: string; score: number; assets: Record<number, string>; width: number; height: number; best: { round: number; layers: any[]; render_url: string; score: number; assets: Record<number, string> } };
  templates: Template[]; rejected: Array<{ path: string; score: number }>;
  faces: Record<string, number>; // family -> votes from matched text slots
  logo_url: string | null; done: boolean;
};

function publicUrl(db: any, path: string) { return db.storage.from('brand-assets').getPublicUrl(path).data.publicUrl; }

async function latestLogo(db: any, clientId: string): Promise<string | null> {
  const { data } = await db.from('client_design_systems').select('system').eq('client_id', clientId).neq('status', 'retired').order('created_at', { ascending: false }).limit(3);
  for (const r of data || []) { const p = r.system?.tokens?.logo?.asset_path || r.system?.logo?.asset_path; if (p) return publicUrl(db, p); }
  return null;
}

async function loadBuild(db: any, clientId: string): Promise<{ id: string; build: Build; version: number } | null> {
  const { data } = await db.from('client_design_systems').select('id,version,system').eq('client_id', clientId).eq('status', 'draft').contains('system', { version: 2 }).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data?.system?.build ? { id: data.id, build: data.system.build as Build, version: data.version } : null;
}

async function saveBuild(db: any, id: string, build: Build, extra: Record<string, unknown> = {}) {
  const system = { version: 2, build, templates: build.templates, faces: facesOf(build), logo: build.logo_url ? { url: build.logo_url } : null, ...extra };
  const previews = build.templates.map((t) => ({ template_id: t.id, format: t.format, url: (t as any).preview_url, source_path: t.source_path, score: t.score }));
  const { error } = await db.from('client_design_systems').update({ system, previews, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(`The build state could not be saved: ${error.message}`);
}

function facesOf(build: Build): { primary: string; secondary?: string } {
  const sorted = Object.entries(build.faces).sort((a, b) => b[1] - a[1]);
  return { primary: sorted[0]?.[0] || 'Poppins', secondary: sorted[1] && sorted[1][1] >= 2 ? sorted[1][0] : undefined };
}

async function startBuild(db: any, clientId: string, userId: string | null): Promise<{ id: string; build: Build; version: number }> {
  const { data: client, error } = await db.from('clients').select('design_references,harvested_design_references').eq('id', clientId).single();
  if (error || !client) throw new Error('Client references could not be loaded.');
  const paths = referencesFor(client.design_references, client.harvested_design_references, MAX_POSTS);
  if (paths.length < 3) throw new Error('Connect this client’s social profiles in Client Setup to discover at least three real brand posts first.');
  const { data: latest } = await db.from('client_design_systems').select('version').eq('client_id', clientId).order('version', { ascending: false }).limit(1).maybeSingle();
  const build: Build = { queue: paths, current: null, templates: [], rejected: [], faces: {}, logo_url: await latestLogo(db, clientId), done: false };
  const { data: row, error: insertError } = await db.from('client_design_systems').insert({ client_id: clientId, version: (latest?.version || 0) + 1, status: 'draft', system: { version: 2, build, templates: [] }, previews: [], built_from: paths, created_by: userId }).select('id,version').single();
  if (insertError) throw new Error(`The build could not be started: ${insertError.message}`);
  return { id: row.id, build, version: row.version };
}

/** One unit of work. Returns the build after it. */
async function step(db: any, clientId: string, state: { id: string; build: Build }): Promise<Build> {
  const b = state.build;
  if (b.done) return b;
  if (!b.current) {
    const path = b.queue.shift();
    if (!path) { b.done = true; await saveBuild(db, state.id, b); return b; }
    const r = await readRemote({ client_id: clientId, path, round: 0, family: facesOf(b).primary, family2: facesOf(b).secondary || null });
    b.current = { path, round: 0, layers: r.layers, render_url: r.render_url, heatmap_url: r.heatmap_url, score: r.score, assets: r.assets || {}, width: r.width, height: r.height, best: { round: 0, layers: r.layers, render_url: r.render_url, score: r.score, assets: r.assets || {} } };
    await saveBuild(db, state.id, b); return b;
  }
  const c = b.current;
  if (c.score < KEEP_SCORE && c.round + 1 < MAX_ROUNDS) {
    const r = await readRemote({ client_id: clientId, path: c.path, round: c.round + 1, family: facesOf(b).primary, family2: facesOf(b).secondary || null, layers: c.layers, render_url: c.render_url, heatmap_url: c.heatmap_url, score: c.score });
    c.round += 1; c.layers = r.layers; c.render_url = r.render_url; c.heatmap_url = r.heatmap_url; c.score = r.score; c.assets = r.assets || {};
    if (r.score > c.best.score) c.best = { round: c.round, layers: r.layers, render_url: r.render_url, score: r.score, assets: r.assets || {} };
    await saveBuild(db, state.id, b); return b;
  }
  // Keep or reject the best read, then match the faces of its two largest text slots.
  const best = c.best;
  if (best.score < 0.45) { b.rejected.push({ path: c.path, score: best.score }); b.current = null; await saveBuild(db, state.id, b); return b; }
  const texts = best.layers.map((L: any, i: number) => ({ L, i })).filter(({ L }: any) => L.type === 'text' && Array.isArray(L.lines) && L.lines.length).sort((a: any, b2: any) => (b2.L.size || 0) - (a.L.size || 0)).slice(0, 2);
  const fontQuery = texts.map(({ L, i }: any) => ({ index: i, x: L.x, y: L.y, w: Math.min(L.w || c.width, c.width - (L.x || 0)), h: L.h || (L.size || 40) * 1.3 * L.lines.length, size: L.size, lineHeight: L.lineHeight, align: L.align, weight: L.weight, lines: L.lines }));
  let faceByLayer: Record<number, string> = {};
  if (fontQuery.length) {
    try { const f = await readRemote({ client_id: clientId, path: c.path, step: 'fonts', text_layers: fontQuery }); for (const r of f.fonts || []) { const top = r.matches?.[0]; if (top && top.score >= 0.3) { faceByLayer[r.index] = top.family; b.faces[top.family] = (b.faces[top.family] || 0) + 1; } } } catch (e) { console.warn('font match failed', e instanceof Error ? e.message : e); }
  }
  const id = `t${b.templates.length + 1}-${c.path.split('/').pop()!.replace(/[^a-z0-9]/gi, '').slice(7, 15)}`;
  const t = templateFromRead({ id, name: `Layout ${b.templates.length + 1}`, source_path: c.path, score: best.score, width: c.width, height: c.height, layers: best.layers, assetUrls: best.assets, logoUrl: b.logo_url, faces: facesOf(b) });
  for (const s of t.slots) { const li = best.layers.findIndex((L: any) => L.type === 'text' && L.role === s.role && L.x === s.x && L.y === s.y); if (li >= 0 && faceByLayer[li]) s.face = faceByLayer[li]; }
  (t as any).preview_url = best.render_url;
  b.templates.push(t); b.current = null;
  await saveBuild(db, state.id, b); return b;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  try {
    const { client_id, action = 'get', id } = await req.json();
    if (!client_id) throw new Error('A client is required.');
    const trusted = await secretEquals(req.headers.get('x-socialytics-secret'), Deno.env.get('SOCIALYTICS_N8N_SECRET'));
    const caller = trusted ? { userId: null as string | null } : await requireStaff(req, { writeClientId: client_id });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'get') {
      const state = await loadBuild(db, client_id);
      return new Response(JSON.stringify({ build: state?.build || null, id: state?.id || null }), { headers });
    }
    if (action === 'step' || action === 'start') {
      let state = action === 'start' ? null : await loadBuild(db, client_id);
      if (!state || state.build.done) state = await startBuild(db, client_id, caller.userId);
      const build = await step(db, client_id, state);
      return new Response(JSON.stringify({ id: state.id, build: { ...build, progress: { kept: build.templates.length, rejected: build.rejected.length, remaining: build.queue.length + (build.current ? 1 : 0), current: build.current ? { path: build.current.path, round: build.current.round, score: build.current.score } : null } } }), { headers });
    }
    if (action === 'approve') {
      if (!id) throw new Error('A build is required.');
      const { data: row, error } = await db.from('client_design_systems').select('id,system').eq('id', id).eq('client_id', client_id).single();
      if (error || !row || !row.system?.build?.done || !(row.system.templates || []).length) throw new Error('This library is not finished yet.');
      const now = new Date().toISOString();
      const paths = (row.system.build.templates as Template[]).map((t) => t.source_path);
      const { data: client } = await db.from('clients').select('harvested_design_references').eq('id', client_id).single();
      const images: Uint8Array[] = [];
      for (const p of paths.slice(0, 6)) { const { data } = await db.storage.from('design-references').download(p); if (data) images.push(new Uint8Array(await data.arrayBuffer())); }
      const pal = images.length ? await palette(images, 8) : [];
      const retire = await db.from('client_design_systems').update({ status: 'retired', updated_at: now }).eq('client_id', client_id).eq('status', 'approved').neq('id', id);
      if (retire.error) throw new Error('The previous system could not be retired.');
      const { error: approveError } = await db.from('client_design_systems').update({ status: 'approved', approved_by: caller.userId, approved_at: now, updated_at: now, system: { ...row.system, palette: pal } }).eq('id', id);
      if (approveError) throw new Error('The library could not be approved.');
      void client;
      return new Response(JSON.stringify({ approved: id, templates: row.system.templates.length, palette: pal }), { headers });
    }
    throw new Error('Unknown action.');
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'The template library could not be built.' }), { status: e instanceof AuthzError ? e.status : 422, headers });
  }
});
