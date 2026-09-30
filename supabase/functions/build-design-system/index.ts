// Build, read or approve a client's design system.
//
// build: one vision read of the client's own published posts gives the brand
// tokens, the locked templates the brand actually uses and the imagery rule;
// the logo is cut once into a transparent asset; a preview of every template
// is rendered so the system can be approved by looking at it. Nothing here
// generates imagery: previews use a stand-in hero drawn from the tokens.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthzError, requireStaff } from '../_shared/auth/requireStaff.ts';
import { referencesFor } from '../_shared/design-prompts/designRefs.ts';
import { sourceImage } from '../_shared/design-prompts/sourceImage.ts';
import { platformDesignSpec } from '../_shared/design-prompts/aspect.ts';
import { BUILD_INSTRUCTIONS, designSystemSchema, normaliseDesignSystem, resolvedFamily } from '../_shared/design-system/build.ts';
import { cutLogo } from '../_shared/design-system/logoAsset.ts';
import { FORMAT_DIMENSIONS, type DesignSystem, type FormatKey, type Template } from '../_shared/design-system/types.ts';
import { bytesToDataUrl, placeholderHero } from '../_shared/design-system/previewHero.ts';
import { renderStill } from '../_shared/render/render.ts';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' };
const BUCKET = 'brand-assets';
const PREVIEW_PLATFORM: Record<FormatKey, [string, string]> = { '4:5': ['Instagram', 'Single Image'], '1:1': ['LinkedIn', 'Carousel'], '9:16': ['Instagram', 'Reel'], '16:9': ['LinkedIn', 'Single Image'], '2:3': ['Pinterest', 'Pin'] };
const SAMPLE = { headline: 'The one idea this post exists to say, in a single line or two', emphasis: 'one idea' };

function publicUrl(db: any, path: string): string { return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }

async function upload(db: any, path: string, bytes: Uint8Array, type: string) {
  const { error } = await db.storage.from(BUCKET).upload(path, new Blob([bytes], { type }), { contentType: type, upsert: true });
  if (error) throw new Error(`A brand asset could not be stored: ${error.message}`);
}

async function readSystem(apiKey: string, images: any[], clientName: string) {
  const tool = { name: 'record_design_system', description: 'Record the design system read from the posts.', input_schema: designSystemSchema() };
  const content = [...images.flatMap((img, i) => [{ type: 'text', text: `Reference ${i}` }, img]), { type: 'text', text: `${BUILD_INSTRUCTIONS}\nThe client is ${clientName}.` }];
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(110_000),
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content }] }),
  });
  if (!response.ok) throw new Error(`The design system could not be read (${response.status}).`);
  const result = await response.json();
  const draft = result.content?.find((c: any) => c.type === 'tool_use' && c.name === tool.name)?.input;
  if (!draft) throw new Error('The design system read returned nothing.');
  return draft;
}

/** The logo as a transparent asset: cut from the reference the read named, else the client's stored logo file. */
async function logoAsset(db: any, clientId: string, version: number, paths: string[], draft: any, logoUrl: string | null): Promise<{ path: string; aspect: number; source: string }> {
  const stamp = `logos/${clientId}/v${version}.png`;
  const box = draft?.logo?.box, index = draft?.logo?.reference_index;
  if (box && Number.isInteger(index) && paths[index] && box.width > 0.02 && box.height > 0.01) {
    try {
      const { data, error } = await db.storage.from('design-references').download(paths[index]);
      if (error || !data) throw new Error('reference missing');
      const cut = await cutLogo(new Uint8Array(await data.arrayBuffer()), box);
      if (cut.width >= 60 && cut.width / cut.height >= 1.2) { await upload(db, stamp, cut.png, 'image/png'); return { path: stamp, aspect: cut.width / cut.height, source: `reference ${index}` }; }
    } catch (e) { console.warn('logo cut failed, falling back', e instanceof Error ? e.message : e); }
  }
  if (logoUrl) {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('The client logo file could not be fetched.');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const img = await Image.decode(bytes);
    const png = await img.encode();
    await upload(db, stamp, png, 'image/png');
    return { path: stamp, aspect: img.width / img.height, source: 'logo file' };
  }
  throw new Error('No usable logo was found in the posts and the client has no logo file.');
}

async function renderPreviews(db: any, clientId: string, version: number, system: DesignSystem, logoAspect: number) {
  const logoHref = bytesToDataUrl(new Uint8Array(await (await db.storage.from(BUCKET).download(system.tokens.logo.asset_path)).data.arrayBuffer()));
  const heroes = new Map<FormatKey, string>();
  const previews: Array<{ template_id: string; format: FormatKey; path: string; font_size: number; lines: number }> = [];
  for (const template of system.templates) {
    const format = template.formats[0];
    const dims = FORMAT_DIMENSIONS[format];
    if (!heroes.has(format)) {
      const glow = template.hero_region === 'left' ? { x: 0.3, y: 0.45 } : template.hero_region === 'top' ? { x: 0.5, y: 0.3 } : template.hero_region === 'bottom' ? { x: 0.5, y: 0.7 } : { x: 0.68, y: 0.45 };
      heroes.set(format, bytesToDataUrl(await placeholderHero(dims.width, dims.height, system.tokens.colors.background, system.tokens.colors.accent, glow)));
    }
    const [platform, fmt] = PREVIEW_PLATFORM[format];
    const out = await renderStill(db, { ...dims, system, template, spec: platformDesignSpec(platform, fmt), headline: SAMPLE.headline, emphasis: SAMPLE.emphasis, heroHref: heroes.get(format)!, logoHref, logoAspect });
    const path = `previews/${clientId}/v${version}-${template.id}.png`;
    await upload(db, path, out.png, 'image/png');
    previews.push({ template_id: template.id, format, path, font_size: out.fontSize, lines: out.lines });
  }
  return previews;
}

function withUrls(db: any, row: any) {
  return { ...row, logo_url: row.system?.tokens?.logo?.asset_path ? publicUrl(db, row.system.tokens.logo.asset_path) : null, previews: (row.previews || []).map((p: any) => ({ ...p, url: publicUrl(db, p.path) })) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  try {
    const { client_id, action = 'get', id } = await req.json();
    if (!client_id) throw new Error('A client is required.');
    const caller = await requireStaff(req, { writeClientId: client_id });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'get') {
      const { data, error } = await db.from('client_design_systems').select('*').eq('client_id', client_id).neq('status', 'retired').order('created_at', { ascending: false }).limit(4);
      if (error) throw new Error('Design systems could not be loaded.');
      return new Response(JSON.stringify({ systems: (data || []).map((r: any) => withUrls(db, r)) }), { headers });
    }

    if (action === 'approve') {
      if (!id) throw new Error('A design system is required.');
      const { data: row, error } = await db.from('client_design_systems').select('id,client_id,status').eq('id', id).eq('client_id', client_id).single();
      if (error || !row) throw new Error('That design system was not found.');
      const now = new Date().toISOString();
      const retire = await db.from('client_design_systems').update({ status: 'retired', updated_at: now }).eq('client_id', client_id).eq('status', 'approved').neq('id', id);
      if (retire.error) throw new Error('The previous design system could not be retired.');
      const { data: approved, error: approveError } = await db.from('client_design_systems').update({ status: 'approved', approved_by: caller.userId, approved_at: now, updated_at: now }).eq('id', id).select('*').single();
      if (approveError) throw new Error('The design system could not be approved.');
      return new Response(JSON.stringify({ system: withUrls(db, approved) }), { headers });
    }

    if (action !== 'build') throw new Error('Unknown action.');
    const { data: client, error: clientError } = await db.from('clients').select('name,design_references,harvested_design_references,logo_url').eq('id', client_id).single();
    if (clientError || !client) throw new Error('Client references could not be loaded.');
    const paths = referencesFor(client.design_references, client.harvested_design_references, 8);
    if (paths.length < 3) throw new Error('Connect this client’s social profiles in Client Setup to discover at least three real brand references first.');
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('The design service is unavailable.');

    const { data: latest } = await db.from('client_design_systems').select('version').eq('client_id', client_id).order('version', { ascending: false }).limit(1).maybeSingle();
    const version = (latest?.version || 0) + 1;
    const images = await Promise.all(paths.map((p) => sourceImage(db, p)));
    const draft = await readSystem(apiKey, images, client.name);
    const logo = await logoAsset(db, client_id, version, paths, draft, client.logo_url || null);
    const system = normaliseDesignSystem(draft, paths, logo.path);
    const face = await resolvedFamily(system.tokens.font.family);
    const notes: string[] = [];
    if (face.substituted) { notes.push(`The posts use a face close to ${system.tokens.font.family}, which is not on Google Fonts; ${face.family} stands in.`); system.tokens.font.family = face.family; }
    notes.push(`Logo taken from ${logo.source}.`);
    system.notes = [system.notes, ...notes].filter(Boolean).join(' ');
    const previews = await renderPreviews(db, client_id, version, system, logo.aspect);
    const { data: row, error: insertError } = await db.from('client_design_systems').insert({ client_id, version, status: 'draft', system: { ...system, logo_aspect: logo.aspect }, previews, built_from: paths, created_by: caller.userId }).select('*').single();
    if (insertError) throw new Error(`The design system could not be saved: ${insertError.message}`);
    return new Response(JSON.stringify({ system: withUrls(db, row) }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'The design system could not be built.' }), { status: e instanceof AuthzError ? e.status : 422, headers });
  }
});
