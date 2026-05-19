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
  /** When true, a brand-aligned seed image is being passed alongside this
   *  prompt as the `image` field on Veo's instance. The prompt then becomes
   *  a MOTION brief that animates the seed rather than a full scene brief. */
  hasSeedImage?: boolean;
}

const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g;

function stripHex(text: string): string {
  return text.replace(HEX_RE, "the brand color");
}

/**
 * Compose a layered video generation prompt for Google Veo. Veo works best
 * with concise, concrete prompts followed by structured brand and platform
 * context. No hex codes appear in the output.
 *
 * Two modes:
 *  - **With seed image** (preferred): the prompt describes how the seed
 *    frame should ANIMATE — camera motion, subject motion, lighting shifts.
 *    The seed already carries the brand palette / composition / typography,
 *    so we keep the prompt motion-focused and explicitly anchor it to the
 *    seed.
 *  - **Without seed image** (fallback): the prompt describes the whole
 *    scene and brand-coherent visual language, since Veo has nothing else
 *    to anchor on.
 */
export function buildVideoPrompt(input: BuildVideoPromptInput): string {
  const sections: string[] = [];
  const scene = stripHex(input.sceneDescription).trim();

  if (input.hasSeedImage) {
    // 1. Anchor instruction — the seed image is the visual ground truth.
    sections.push(
      "ANCHOR FRAME: The provided image is the opening frame of this video and " +
        "the visual ground truth — preserve its exact palette, composition, " +
        "typography, lighting, and brand feel as the clip plays. The video " +
        "should look like a 5-8 second continuation of that single image, not " +
        "a different scene.",
    );

    // 2. Motion brief built from the scene description.
    sections.push(`MOTION BRIEF (what happens during the 5-8 seconds): ${scene}`);

    sections.push(
      "Lean into subtle, brand-appropriate motion: a slow parallax push, a " +
        "gentle reveal, a smooth subject movement, a soft light shift. Keep " +
        "every frame look like it could be a still from the same campaign as " +
        "the anchor frame. No sudden cuts to unrelated scenes, no genre swaps, " +
        "no AI-flavored morphing.",
    );
  } else {
    // No seed — give Veo the full scene description with no anchor.
    sections.push(scene);
  }

  // 3. Brand design language (synthesis or fallback). Even with a seed image
  //    this provides Veo with the qualitative vocabulary for motion choices.
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

  // 4. Platform playbook (motion guidance is the headline section here)
  const playbook = getPlaybookEntry(input.platform, input.format);
  sections.push(renderPlaybookSection(playbook, input.platform, input.format));

  // 5. Variant angle (Phase 7 will populate this for multi-variant flows)
  if (input.variantAngle && input.variantAngle.trim()) {
    sections.push(`Variant angle: ${input.variantAngle.trim()}`);
  }

  // 6. Hard constraints (short, qualitative)
  sections.push(
    "Constraints: No text overlays, watermarks, logos, or color codes visible in any frame. " +
      "No real people's names or celebrity likenesses. " +
      "Describe colors only through the visual look, never as written codes. " +
      "Avoid generic stock-video clichés (people on laptops in coffee shops, abstract gradient backgrounds, " +
      "spinning 3D shapes) unless the brand language explicitly calls for them.",
  );

  return sections.join("\n\n");
}
