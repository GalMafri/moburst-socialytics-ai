import { describe, expect, it } from 'vitest';
import { artworkCorrection, artworkReviewQuestion, designedHeroPrompt, eligibleTemplates, pickTemplates, templateById } from '../../supabase/functions/_shared/design-system/load.ts';
import { normaliseDesignSystem } from '../../supabase/functions/_shared/design-system/build.ts';
import { platformDesignSpec } from '../../supabase/functions/_shared/design-prompts/aspect.ts';
import type { DesignSystem } from '../../supabase/functions/_shared/design-system/types.ts';

const system: DesignSystem = {
  version: 1,
  tokens: { font: { family: 'DM Sans', body_weight: 400, emphasis_weight: 700, casing: 'sentence' }, colors: { ink: '#ffffff', surface: '#1e2535', accent: '#00c2e0', background: '#0d1117', frame: ['#ff4444', '#4444ff'] }, card: { style: 'glass', alpha: 0.65, radius_em: 1, border_alpha: 0.18 }, frame: { style: 'gradient', width_pct: 1 }, logo: { asset_path: 'logos/c/v2.png', position: 'top-center', width_pct: { portrait: 28, square: 22, landscape: 18 } } },
  imagery: { style: 'Dark 3-D renders with cyan glow.', subjects: 'Gems, satellites.', never: ['pastel backgrounds', 'cartoons'] },
  templates: [
    { id: 'quote-photo', name: 'Quote', formats: ['16:9', '1:1'], hero: 'photo', headline: { region: 'left', width_pct: 55, max_lines: 4 }, hero_region: 'right', card: true, frame: false },
    { id: 'cover-portrait', name: 'Cover', formats: ['4:5', '9:16'], hero: 'generated', headline: { region: 'center', width_pct: 78, max_lines: 4 }, hero_region: 'background', card: true, frame: true },
    { id: 'card-portrait', name: 'Card', formats: ['4:5', '9:16'], hero: 'generated', headline: { region: 'center', width_pct: 72, max_lines: 3 }, hero_region: 'background', card: true, frame: true },
    { id: 'blog-wide', name: 'Blog', formats: ['16:9', '1:1'], hero: 'generated', headline: { region: 'left', width_pct: 48, max_lines: 5 }, hero_region: 'right', card: false, frame: false },
  ],
  sources: [],
};
const plan = (positions: string[]) => ({ brand_system: '', frames: positions.map((p, i) => ({ headline: `Headline ${i}`, subject: `Subject ${i}`, composition: '', action: '', reference_indices: [0, 1], layout: { reference_index: 0, headline_position: p as any, subject_position: 'right' as const, logo_position: 'top-center' as const } })) });

describe('template choice', () => {
  it('runs only templates with a generated hero, in the frame format, falling back to the same orientation', () => {
    expect(eligibleTemplates(system, '16:9').map((t) => t.id)).toEqual(['blog-wide']);
    expect(eligibleTemplates(system, '4:5').map((t) => t.id)).toEqual(['cover-portrait', 'card-portrait']);
    expect(eligibleTemplates(system, '2:3').map((t) => t.id)).toEqual(['cover-portrait', 'card-portrait']);
  });
  it('prefers the planned headline position, keeps frames of one run distinct, and avoids the client’s recent templates', () => {
    expect(pickTemplates(system, '4:5', plan(['center']), ['cover-portrait'])).toEqual(['card-portrait']);
    expect(pickTemplates(system, '4:5', plan(['center', 'center', 'center']), [])).toEqual(['cover-portrait', 'card-portrait', 'cover-portrait']);
    expect(pickTemplates(system, '16:9', plan(['left']), [])).toEqual(['blog-wide']);
    expect(() => pickTemplates({ ...system, templates: [system.templates[0]] }, '16:9', plan(['left']), [])).toThrow(/no template/);
  });
  it('names the template a run was planned with and refuses one that is gone', () => {
    expect(templateById(system, 'blog-wide').name).toBe('Blog');
    expect(() => templateById(system, 'vanished')).toThrow(/no longer/);
  });
});

describe('hero prompt and review for a design-system run', () => {
  const spec = platformDesignSpec('LinkedIn', 'Single Image');
  it('asks for the generated layer only, shaped for the template, with no text or logo', () => {
    const p = designedHeroPrompt(plan(['left']) as any, 0, system, templateById(system, 'blog-wide'), spec);
    expect(p).toContain('Subject 0');
    expect(p).toContain('Keep the left 48% of the width calm');
    expect(p).toContain('Render NO lettering');
    expect(p).toContain('Render NO logo');
    expect(p).toContain('Dark 3-D renders with cyan glow.');
    expect(p).toContain('Never show: pastel backgrounds, cartoons');
    expect(p).toContain('18% of image width');
  });
  it('keeps the hero object away from a centred card on a full-frame template', () => {
    const p = designedHeroPrompt(plan(['center']) as any, 0, system, templateById(system, 'cover-portrait'), platformDesignSpec('Instagram', 'Single Image'));
    expect(p).toContain('in the lower 40% of the frame');
    expect(p).toContain('a card over the hero object would hide it');
  });
  it('reviews the artwork layer alone and never faults a missing logo or card', () => {
    const q = artworkReviewQuestion(system, templateById(system, 'blog-wide'), 'A prism');
    expect(q).toContain('Never mark a defect for a missing logo, wordmark, icon, card');
    expect(q).toContain('calm region: left (48% of the width)');
    expect(q).toContain('Never: pastel backgrounds, cartoons');
    expect(q).not.toMatch(/MUST carry the brand tokens/);
  });
  it('turns the verdict into a retry instruction', () => {
    expect(artworkCorrection({ reason: 'Rays fill the left region.', off_brand: true })).toMatch(/failed review: Rays fill the left region\..*calm region dark and quiet/);
    expect(artworkCorrection({ has_logo: true })).toContain('Render no logo');
    expect(artworkCorrection({ has_text: true })).toContain('Remove every trace of lettering');
    expect(artworkCorrection({})).toBe('');
  });
});

describe('normalising a read design system', () => {
  const draft = { font: { family: 'DM Sans', body_weight: 400, casing: 'sentence' }, colors: { ink: '#FFFFFF', surface: '#1e2535', accent: 'notahex', background: '#0d1117', frame: ['#ff4444', 'bad', '#4444ff'] }, card: { style: 'glass', alpha: 7, radius_em: 1, border_alpha: 0.18 }, frame: { style: 'gradient', width_pct: 1 }, logo: { position: 'top-center', width_pct: { portrait: 90, square: 22, landscape: 18 } }, imagery: { style: 's', subjects: 'x', never: ['a'] }, templates: [
    { id: 'A Bad Id!', name: 'One', formats: ['4:5'], hero: 'generated', headline: { region: 'center', width_pct: 78, max_lines: 4 }, hero_region: 'background', card: true, frame: true, notes: '' },
    { id: 'two', name: 'Two', formats: ['16:9', 'nope'], hero: 'generated', headline: { region: 'left', width_pct: 48, max_lines: 5 }, hero_region: 'right', card: false, frame: false, notes: '' },
    { id: 'three', name: 'Three', formats: ['1:1'], hero: 'photo', headline: { region: 'left', width_pct: 55, max_lines: 4 }, hero_region: 'right', card: true, frame: false, notes: '' },
  ] };
  it('clamps numbers, drops bad colours and unknown formats, and keeps the logo asset path', () => {
    const s = normaliseDesignSystem(draft, ['p1', 'p2', 'p3'], 'logos/c/v1.png');
    expect(s.tokens.colors.ink).toBe('#ffffff');
    expect(s.tokens.colors.accent).toBe('#3bd4ff');
    expect(s.tokens.colors.frame).toEqual(['#ff4444', '#4444ff']);
    expect(s.tokens.card.alpha).toBe(1);
    expect(s.tokens.logo.width_pct.portrait).toBe(45);
    expect(s.tokens.logo.asset_path).toBe('logos/c/v1.png');
    expect(s.templates.map((t) => t.id)).toEqual(['a-bad-id-', 'two', 'three']);
    expect(s.templates[1].formats).toEqual(['16:9']);
    expect(s.sources).toEqual(['p1', 'p2', 'p3']);
  });
  it('refuses fewer than three layouts or repeated ids', () => {
    expect(() => normaliseDesignSystem({ ...draft, templates: draft.templates.slice(0, 2) }, [], 'x')).toThrow(/at least three/);
    expect(() => normaliseDesignSystem({ ...draft, templates: [draft.templates[1], draft.templates[1], draft.templates[2]] }, [], 'x')).toThrow(/repeat/);
  });
});
