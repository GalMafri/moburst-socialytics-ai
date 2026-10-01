// One round of reading a client's post into a layered template.
//
// round 0: the model proposes the layers from the post alone.
// round n: the model sees the post, the last render and the difference heatmap
//          and corrects the layers.
// Every round renders the proposal, scores it against the post (SSIM on
// greyscale) and stores render and heatmap in brand-assets, so the caller can
// stop when the score is good enough or keep the best of a few rounds.
// Faces are matched by code from the text crops (step 'fonts').
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { AuthzError, requireStaff } from '../_shared/auth/requireStaff.ts';
import { secretEquals } from '../_shared/auth/secretEquals.ts';
import { Faces, renderLayers, type Spec } from '../_shared/render/layers.ts';
import { fontBytes } from '../_shared/render/fonts.ts';
import { bytesToDataUrl } from '../_shared/render/hero.ts';
import { similarity } from '../_shared/design-system/compare.ts';
import { matchFont } from '../_shared/design-system/fontMatch.ts';
import { cutLogo } from '../_shared/design-system/logoAsset.ts';
import { SPEC_TOOL, proposeInstructions, refineInstructions, toSpec } from '../_shared/design-system/reader.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-socialytics-secret' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const BUCKET = 'brand-assets';

async function store(db: any, path: string, bytes: Uint8Array, type = 'image/png'): Promise<string> {
  const { error } = await db.storage.from(BUCKET).upload(path, new Blob([bytes], { type }), { contentType: type, upsert: true });
  if (error) throw new Error(`Could not store ${path}: ${error.message}`);
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function postBytes(db: any, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from('design-references').download(path);
  if (error || !data) throw new Error('The post image could not be loaded.');
  return new Uint8Array(await data.arrayBuffer());
}

async function callModel(apiKey: string, content: any[]): Promise<any> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(110_000),
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 6000, tools: [SPEC_TOOL], tool_choice: { type: 'tool', name: SPEC_TOOL.name }, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`The layer read failed (${res.status}).`);
  const out = await res.json();
  const input = out.content?.find((c: any) => c.type === 'tool_use' && c.name === SPEC_TOOL.name)?.input;
  if (!input?.layers) throw new Error('The layer read returned nothing.');
  return input;
}

const imageBlock = (bytes: Uint8Array, mime = 'image/jpeg') => ({ type: 'image', source: { type: 'base64', media_type: mime, data: bytesToDataUrl(bytes, mime).split(',')[1] } });

/** The client's known logo asset, when a design system already holds one; the reader never re-cuts a logo it has. */
async function knownLogo(db: any, clientId: string): Promise<string | null> {
  const { data } = await db.from('client_design_systems').select('system').eq('client_id', clientId).neq('status', 'retired').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const path = data?.system?.tokens?.logo?.asset_path; if (!path) return null;
  const { data: file } = await db.storage.from(BUCKET).download(path); if (!file) return null;
  return bytesToDataUrl(new Uint8Array(await file.arrayBuffer()));
}

/** Image layers: lifted assets are cut from the post itself; photos and heroes use the post's own pixels in that box so the render can be compared. */
async function imageHrefs(post: Image, layers: any[], db: any, clientId: string, stamp: string): Promise<{ hrefs: Record<number, string>; assets: Record<number, string> }> {
  const hrefs: Record<number, string> = {}; const assets: Record<number, string> = {};
  const logo = layers.some((L) => L.type === 'image' && L.role === 'logo') ? await knownLogo(db, clientId) : null;
  const postPng = await post.encode();
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i]; if (L.type !== 'image') continue;
    const x = Math.max(0, Math.round(L.x || 0)), y = Math.max(0, Math.round(L.y || 0));
    const w = Math.max(2, Math.min(post.width - x, Math.round(L.w || 10))), h = Math.max(2, Math.min(post.height - y, Math.round(L.h || 10)));
    if (L.role === 'logo' && logo) { hrefs[i] = logo; continue; }
    if (L.lift) {
      try {
        const cut = await cutLogo(postPng, { x: x / post.width, y: y / post.height, width: w / post.width, height: h / post.height }, 0.04);
        const path = `assets/${clientId}/${stamp}-${i}-${L.role || 'asset'}.png`; assets[i] = await store(db, path, cut.png); hrefs[i] = bytesToDataUrl(cut.png); continue;
      } catch { /* fall back to the raw crop */ }
    }
    const crop = post.clone().crop(x, y, w, h); hrefs[i] = bytesToDataUrl(await crop.encode());
  }
  return { hrefs, assets };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const clientId = String(body.client_id || ''); if (!clientId) return json({ error: 'client_id is required' }, 400);
    const trusted = await secretEquals(req.headers.get('x-socialytics-secret'), Deno.env.get('SOCIALYTICS_N8N_SECRET'));
    if (!trusted) await requireStaff(req, { writeClientId: clientId });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY'); if (!apiKey) return json({ error: 'The design service is unavailable.' }, 503);
    const path = String(body.path || ''); if (!path) return json({ error: 'path is required' }, 400);
    const bytes = await postBytes(db, path); const post = await Image.decode(bytes);
    const stamp = `${Date.now()}`;

    if (body.step === 'fonts') {
      // body.text_layers: [{index, text, weight, x,y,w,h}] from the kept spec
      const out: any[] = [];
      for (const t of (body.text_layers || []).slice(0, 4)) {
        const crop = post.clone().crop(Math.max(0, Math.round(t.x)), Math.max(0, Math.round(t.y)), Math.max(2, Math.round(t.w)), Math.max(2, Math.round(t.h)));
        const matches = await matchFont(db, crop, String(t.text || '').slice(0, 40), t.weight >= 600 ? 700 : 400, body.families);
        out.push({ index: t.index, matches: matches.slice(0, 5) });
      }
      return json({ fonts: out });
    }

    const round = Number(body.round || 0);
    const content: any[] = [imageBlock(bytes)];
    if (round > 0 && body.render_url && body.heatmap_url && Array.isArray(body.layers)) {
      const [render, heat] = await Promise.all([fetch(body.render_url).then((r) => r.arrayBuffer()), fetch(body.heatmap_url).then((r) => r.arrayBuffer())]);
      content.push({ type: 'text', text: 'RENDER of the previous layers:' }, imageBlock(new Uint8Array(render), 'image/png'), { type: 'text', text: 'HEATMAP of differences:' }, imageBlock(new Uint8Array(heat), 'image/png'), { type: 'text', text: `Previous layers: ${JSON.stringify(body.layers).slice(0, 12000)}` }, { type: 'text', text: refineInstructions(Number(body.score || 0)) });
    } else content.push({ type: 'text', text: proposeInstructions(post.width, post.height) });
    const proposal = await callModel(apiKey, content);

    const { hrefs, assets } = await imageHrefs(post, proposal.layers, db, clientId, stamp);
    const spec: Spec = toSpec(proposal.layers, post.width, post.height, (_, i) => hrefs[i] || null);
    const family = String(body.family || 'Poppins'); const family2 = body.family2 ? String(body.family2) : null;
    const files: Record<string, Record<number, Uint8Array>> = { [family]: {} };
    for (const w of [300, 400, 700]) { try { files[family][w] = await fontBytes(db, family, w); } catch { /* weight missing */ } }
    if (family2) { files[family2] = {}; for (const w of [300, 400, 700]) { try { files[family2][w] = await fontBytes(db, family2, w); } catch { /* weight missing */ } } }
    const faces = new Faces(family, files);
    const png = await renderLayers(db, spec, faces);
    const sim = await similarity(bytes, png);
    const [render_url, heatmap_url] = await Promise.all([store(db, `reads/${clientId}/${stamp}-r${round}.png`, png), store(db, `reads/${clientId}/${stamp}-r${round}-heat.png`, sim.heatmap)]);
    return json({ round, score: Number(sim.ssim.toFixed(3)), mean_abs_diff: Number(sim.meanAbsDiff.toFixed(3)), layers: proposal.layers, notes: proposal.notes, assets, render_url, heatmap_url, width: post.width, height: post.height });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    return json({ error: err instanceof Error ? err.message : 'The post could not be read.' }, 500);
  }
});
