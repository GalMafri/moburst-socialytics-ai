// A client's design system as data: the brand tokens read from its own posts,
// the locked layout templates the app fills per post, and the rule for the one
// generated layer (the hero). Built once per client, approved once, then every
// post is rendered from it.
export type LogoPosition = 'top-left' | 'top-center' | 'top-right';
export type Region = 'left' | 'right' | 'top' | 'bottom' | 'center';
export type FormatKey = '4:5' | '1:1' | '9:16' | '16:9' | '2:3';

export interface Tokens {
  font: { family: string; body_weight: 400 | 700; emphasis_weight: 700; casing: 'sentence' | 'title' | 'upper' };
  colors: { ink: string; surface: string; accent: string; background: string; frame?: string[] };
  card: { style: 'glass' | 'solid' | 'none'; alpha: number; radius_em: number; border_alpha: number };
  frame: { style: 'gradient' | 'hairline' | 'none'; width_pct: number };
  logo: { asset_path: string; position: LogoPosition; width_pct: { portrait: number; square: number; landscape: number } };
}

export interface Template {
  id: string;
  name: string;
  formats: FormatKey[];
  hero: 'generated' | 'photo' | 'none';
  headline: { region: Region; width_pct: number; max_lines: number; scale?: number };
  hero_region: Region | 'background';
  sub?: { region: 'below' | 'above'; scale: number } | null;
  card: boolean;
  frame: boolean;
  notes?: string;
}

export interface ImageryRule {
  style: string;          // materials, lighting, palette proportions, rendering craft
  subjects: string;       // the kinds of heroes this brand uses
  never: string[];        // what must not appear
}

export interface DesignSystem {
  version: 1;
  tokens: Tokens;
  imagery: ImageryRule;
  templates: Template[];
  sources: string[];      // reference paths the system was read from
  notes?: string;
}

export const FORMAT_DIMENSIONS: Record<FormatKey, { width: number; height: number }> = {
  '4:5': { width: 1080, height: 1350 }, '1:1': { width: 1080, height: 1080 }, '9:16': { width: 1080, height: 1920 }, '16:9': { width: 1200, height: 675 }, '2:3': { width: 1000, height: 1500 },
};

export function formatKeyFor(aspect: string): FormatKey {
  return (['4:5', '1:1', '9:16', '16:9', '2:3'].includes(aspect) ? aspect : '1:1') as FormatKey;
}
