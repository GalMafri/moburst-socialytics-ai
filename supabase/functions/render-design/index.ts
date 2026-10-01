// Render exactly one still from a client's design system. One render per
// request keeps each call inside the edge runtime's CPU budget; the worker
// and the design-system builder call this once per frame or per preview.
//
// kind 'preview': a template preview with a stand-in hero drawn from the tokens.
// kind 'frame':   a planned frame of a creative run with its approved hero.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthzError, requireStaff } from '../_shared/auth/requireStaff.ts';
import { secretEquals } from '../_shared/auth/secretEquals.ts';
import { platformDesignSpec } from '../_shared/design-prompts/aspect.ts';
import { loadCreativePlan } from '../_shared/design-prompts/loadCreativePlan.ts';
import { FORMAT_DIMENSIONS, type DesignSystem, type FormatKey, type Template } from '../_shared/design-system/types.ts';
import { loadSystemById, templateById, formatKeyForSpec } from '../_shared/design-system/load.ts';
import { placeholderHero } from '../_shared/design-system/previewHero.ts';
import { bytesToDataUrl, heroHrefs } from '../_shared/render/hero.ts';
import { renderStill } from '../_shared/render/render.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-socialytics-secret' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const WASM = new URL('./resvg.wasm', import.meta.url);
const PREVIEW_PLATFORM: Record<FormatKey, [string, string]> = { '4:5': ['Instagram', 'Single Image'], '1:1': ['LinkedIn', 'Carousel'], '9:16': ['Instagram', 'Reel'], '16:9': ['LinkedIn', 'Single Image'], '2:3': ['Pinterest', 'Pin'] };

async function logoHrefFor(db: any, system: DesignSystem): Promise<string> {
  const { data, error } = await db.storage.from('brand-assets').download(system.tokens.logo.asset_path);
  if (error || !data) throw new Error('The client logo asset could not be loaded.');
  return bytesToDataUrl(new Uint8Array(await data.arrayBuffer()));
}

async function store(db: any, bucket: string, path: string, png: Uint8Array): Promise<string> {
  const { error } = await db.storage.from(bucket).upload(path, new Blob([png], { type: 'image/png' }), { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`The rendered design could not be stored: ${error.message}`);
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** A template preview: tokens, type, logo and layout over a stand-in hero, stored in brand-assets. */
async function renderPreview(db: any, clientId: string, system: DesignSystem, logoAspect: number, template: Template, version: number, headline: string, emphasis: string) {
  const format = template.formats[0];
  const dims = FORMAT_DIMENSIONS[format];
  const glow = template.hero_region === 'left' ? { x: 0.3, y: 0.45 } : template.hero_region === 'top' ? { x: 0.5, y: 0.3 } : template.hero_region === 'bottom' ? { x: 0.5, y: 0.7 } : { x: 0.68, y: 0.45 };
  const small = await placeholderHero(Math.round(dims.width / 8), Math.round(dims.height / 8), system.tokens.colors.background, system.tokens.colors.accent, glow);
  const heroHref = bytesToDataUrl(small);
  const [platform, fmt] = PREVIEW_PLATFORM[format];
  const out = await renderStill(db, { ...dims, system, template, spec: platformDesignSpec(platform, fmt), headline, emphasis, heroHref, softHeroHref: heroHref, logoHref: await logoHrefFor(db, system), logoAspect }, WASM);
  const path = `previews/${clientId}/v${version}-${template.id}.png`;
  return { template_id: template.id, format, path, url: await store(db, 'brand-assets', path, out.png), font_size: out.fontSize, lines: out.lines };
}

/** A planned frame with its approved hero, stored in generated-media. */
async function renderFrame(db: any, creative: any, index: number, heroUrl: string) {
  const plan = creative.plan;
  const frame = plan.frames[index];
  if (!frame || !plan.design_system_id || !frame.template_id) throw new Error('This frame was not planned with a design system.');
  const loaded = await loadSystemById(db, creative.client_id, plan.design_system_id);
  const template = templateById(loaded.system, frame.template_id);
  const spec = platformDesignSpec(creative.platform, creative.format);
  const dims = FORMAT_DIMENSIONS[formatKeyForSpec(spec)];
  const res = await fetch(heroUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`The approved hero could not be fetched [${res.status}]`);
  const hero = await heroHrefs(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || 'image/png');
  const out = await renderStill(db, { ...dims, system: loaded.system, template, spec, headline: frame.headline, emphasis: frame.emphasis || null, heroHref: hero.heroHref, softHeroHref: hero.softHeroHref, logoHref: await logoHrefFor(db, loaded.system), logoAspect: loaded.logoAspect }, WASM);
  const path = `${creative.client_id}/${Date.now()}-design-${creative.id}-${index}.png`;
  return { index, template_id: template.id, url: await store(db, 'generated-media', path, out.png), font_size: out.fontSize, lines: out.lines };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const clientId = String(body.client_id || '');
    if (!clientId) return json({ error: 'client_id is required' }, 400);
    const trusted = await secretEquals(req.headers.get('x-socialytics-secret'), Deno.env.get('SOCIALYTICS_N8N_SECRET'));
    if (!trusted) await requireStaff(req, { writeClientId: clientId });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (body.kind === 'preview') {
      const { system, logo_aspect, template_id, version, headline, emphasis } = body;
      if (!system || !template_id) return json({ error: 'system and template_id are required' }, 400);
      const template = (system as DesignSystem).templates.find((t) => t.id === template_id);
      if (!template) return json({ error: 'unknown template' }, 400);
      return json(await renderPreview(db, clientId, system, Number(logo_aspect) || 3, template, Number(version) || 0, String(headline || ''), String(emphasis || '')));
    }
    if (body.kind === 'frame') {
      const creative = await loadCreativePlan(db, body.plan_id, clientId);
      const index = Number(body.frame_index);
      if (!Number.isInteger(index) || !body.hero_url) return json({ error: 'frame_index and hero_url are required' }, 400);
      return json(await renderFrame(db, creative, index, String(body.hero_url)));
    }
    return json({ error: 'kind must be preview or frame' }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    return json({ error: err instanceof Error ? err.message : 'The design could not be rendered.' }, 500);
  }
});
