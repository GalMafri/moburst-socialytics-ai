// supabase/functions/_shared/design-prompts/buildVideoPrompt.ts

import { flattenSynthesis, type DesignStyleSynthesis } from "./flattenSynthesis.ts";
import {
  getPlaybookEntry,
  renderPlaybookSection,
} from "./platformPlaybook.ts";

export interface BuildVideoPromptInput {
  sceneDescription: string;
  platform?: string;
  format?: string;
  brandIdentity?: any;
  synthesis?: DesignStyleSynthesis | null;
  post?: { pillar?: string; visual_direction?: string; copy?: string };
  variantAngle?: string | null;
}

const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g;

function stripHex(text: string): string {
  return text.replace(HEX_RE, "the brand color");
}

/**
 * Compose a layered video generation prompt for Google Veo. Veo works best
 * with concise scene descriptions (1-3 sentences) followed by structured
 * brand and platform context. This builder keeps the scene description at
 * the top, layers brand design language and platform motion guidance, and
 * ends with short constraints. No hex codes appear in the output.
 */
export function buildVideoPrompt(input: BuildVideoPromptInput): string {
  const sections: string[] = [];

  // 1. The single-shot scene description (already distilled upstream)
  sections.push(stripHex(input.sceneDescription).trim());

  // 2. Brand design language (synthesis or fallback)
  const synthesisMd = flattenSynthesis(input.synthesis);
  if (synthesisMd) {
    sections.push(synthesisMd);
  } else if (input.brandIdentity) {
    const lines: string[] = [];
    if (input.brandIdentity.visual_style) lines.push(`Visual style: ${input.brandIdentity.visual_style}`);
    if (input.brandIdentity.tone_of_voice) lines.push(`Tone: ${input.brandIdentity.tone_of_voice}`);
    if (input.brandIdentity.background_style) lines.push(`Environment: ${input.brandIdentity.background_style}`);
    if (input.brandIdentity.design_elements) lines.push(`Design language: ${input.brandIdentity.design_elements}`);
    if (lines.length > 0) sections.push(lines.join(". ") + ".");
  }

  // 3. Platform playbook (motion guidance is the headline section here)
  const playbook = getPlaybookEntry(input.platform, input.format);
  sections.push(renderPlaybookSection(playbook, input.platform, input.format));

  // 4. Variant angle (Phase 7 will populate this for multi-variant flows)
  if (input.variantAngle && input.variantAngle.trim()) {
    sections.push(`Variant angle: ${input.variantAngle.trim()}`);
  }

  // 5. Hard constraints (short)
  sections.push(
    "Constraints: No text overlays, watermarks, logos, or color codes visible in any frame. " +
      "No real people's names or celebrity likenesses. " +
      "Describe colors only through the visual look, never as written codes.",
  );

  return sections.join("\n\n");
}
