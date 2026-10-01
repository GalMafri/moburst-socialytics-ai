// Reading a client's design system for a run, choosing templates for its
// frames, and the artwork prompt that asks only for the generated layer.
import type { PlatformDesignSpec } from '../design-prompts/aspect.ts';
import type { CreativePlan } from '../design-prompts/creativePlan.ts';
import { formatKeyFor, type DesignSystem, type FormatKey, type Template } from './types.ts';

export interface LoadedSystem { id: string; status: string; system: DesignSystem; logoAspect: number }

function rowToLoaded(row: any): LoadedSystem {
  const { logo_aspect, ...system } = row.system || {};
  return { id: row.id, status: row.status, system: system as DesignSystem, logoAspect: Number(logo_aspect) || 3 };
}

/** The client's approved design system, or null when designs still run without one. */
export async function loadApprovedSystem(db: any, clientId: string): Promise<LoadedSystem | null> {
  const { data, error } = await db.from('client_design_systems').select('id,status,system').eq('client_id', clientId).eq('status', 'approved').order('approved_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('The design system could not be read.');
  return data ? rowToLoaded(data) : null;
}

/** A specific system by id, whatever its status: a run keeps the system it started with. */
export async function loadSystemById(db: any, clientId: string, id: string): Promise<LoadedSystem> {
  const { data, error } = await db.from('client_design_systems').select('id,status,system').eq('client_id', clientId).eq('id', id).single();
  if (error || !data) throw new Error('The design system this run was planned with no longer exists.');
  return rowToLoaded(data);
}

const orientationOf = (f: FormatKey) => (f === '9:16' || f === '4:5' || f === '2:3') ? 'portrait' : f === '16:9' ? 'landscape' : 'square';

/** Templates that can run automatically for this format: hero generated, format supported (same orientation as a fallback). */
export function eligibleTemplates(system: DesignSystem, format: FormatKey): Template[] {
  const generated = system.templates.filter((t) => t.hero === 'generated');
  const exact = generated.filter((t) => t.formats.includes(format));
  if (exact.length) return exact;
  const same = generated.filter((t) => t.formats.some((f) => orientationOf(f) === orientationOf(format)));
  return same.length ? same : generated;
}

/**
 * One template per frame: prefer the planner's headline position, keep the
 * frames of one run on distinct templates, and avoid the templates the
 * client's most recent designs used so consecutive posts do not match.
 */
export function pickTemplates(system: DesignSystem, format: FormatKey, plan: CreativePlan, recentTemplateIds: string[]): string[] {
  const pool = eligibleTemplates(system, format);
  if (!pool.length) throw new Error('The approved design system has no template with a generated hero for this format.');
  const recent = new Set(recentTemplateIds);
  const used = new Set<string>();
  return plan.frames.map((frame) => {
    const wanted = frame.layout?.headline_position;
    const score = (t: Template) => (used.has(t.id) ? 100 : 0) + (recent.has(t.id) ? 10 : 0) + (wanted && t.headline.region === wanted ? 0 : 1);
    const best = [...pool].sort((a, b) => score(a) - score(b))[0];
    used.add(best.id);
    return best.id;
  });
}

export function templateById(system: DesignSystem, id: string | undefined): Template {
  const t = system.templates.find((x) => x.id === id);
  if (!t) throw new Error('A template this run was planned with is no longer in the design system.');
  return t;
}

export function formatKeyForSpec(spec: PlatformDesignSpec): FormatKey { return formatKeyFor(spec.aspect); }

/** The artwork prompt when a design system exists: the generated layer only, shaped for the template that will carry it. */
export function designedHeroPrompt(plan: CreativePlan, index: number, system: DesignSystem, template: Template, spec: PlatformDesignSpec, correction = ''): string {
  const f = plan.frames[index];
  if (!f) throw new Error('That scene is not in the creative plan.');
  const region = template.headline.region;
  const side = region === 'left' || region === 'right';
  const calm = side ? `the ${region} ${Math.round(template.headline.width_pct)}% of the width` : region === 'center' ? 'the central third of the height' : `the ${region} 40% of the height`;
  const o = spec.aspect === '16:9' ? 'landscape' : spec.aspect === '1:1' ? 'square' : 'portrait';
  const logoW = system.tokens.logo.width_pct[o];
  return [
    spec.note,
    'Create ONE new full-frame brand artwork for this client. The attached images are the client\'s own published posts. They carry the brand tokens; take the tokens from the pixels, not from words: the exact colours and how much of the surface each one covers, the background depth and atmosphere, the light effects, glows, materials and textures, and the way hero objects are rendered and lit.',
    'Build a NEW scene with those tokens for this message. Do not reproduce any attached layout, subject, photograph, person, product or campaign text, and do not strip the brand away into a generic stock render.',
    `Imagery rule for this brand: ${system.imagery.style} Subjects this brand uses: ${system.imagery.subjects}${system.imagery.never.length ? ` Never show: ${system.imagery.never.join(', ')}.` : ''}`,
    `Hero subject for this artwork: ${f.subject}. Render it as ONE physical object or scene with product-render craft, in the references' materials and lighting.`,
    `Place the hero subject in the ${template.hero_region === 'background' ? 'full frame as an atmospheric backdrop' : `${template.hero_region} region`}. Keep ${calm} calm, low in detail and darker, because the application sets the headline there afterwards in the brand's own typeface on ${system.tokens.card.style === 'none' ? 'the artwork itself' : 'a translucent card'}.`,
    'Render NO lettering, words, numbers, captions, wordmarks, watermarks, interfaces or text containers of any kind, not even blurred or tiny in the background. The application adds the exact headline, its card and the authentic client logo afterwards.',
    'One edge-to-edge composition, no contact sheet, mock social interface, slide counter, empty text card, blank placeholder or extra captions. Do not invent people, endorsements, statistics or product claims.',
    `Render NO logo, wordmark, brand name or substitute icon. Leave breathing room at ${system.tokens.logo.position} for software to place the real client logo: its footprint is ${Math.round(logoW)}% of image width and 8% of image height, starting 4.5% from the top. Keep the hero subject clear of that footprint and continue the backdrop naturally behind it; draw no band, strip, panel or placeholder there.`,
    correction ? `Correct the previous attempt: ${correction.slice(0, 1600)}` : '',
  ].filter(Boolean).join('\n\n');
}
