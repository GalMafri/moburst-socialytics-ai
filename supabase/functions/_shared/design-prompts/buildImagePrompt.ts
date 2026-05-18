// supabase/functions/_shared/design-prompts/buildImagePrompt.ts

import { flattenSynthesis, type DesignStyleSynthesis } from "./flattenSynthesis.ts";
import {
  getPlaybookEntry,
  renderPlaybookSection,
} from "./platformPlaybook.ts";

export interface BuildImagePromptInput {
  basePrompt: string;
  platform?: string;
  format?: string;
  brandIdentity?: any;
  synthesis?: DesignStyleSynthesis | null;
  pillars?: Array<{ name: string; description: string }>;
  briefText?: string | null;
  brandNotes?: string | null;
  languages?: string[];
  geo?: string[];
  post?: {
    pillar?: string;
    language?: string;
    visual_direction?: string;
    copy?: string;
  };
  variantAngle?: string | null;
  slideContext?: {
    index: number;
    total: number;
  };
}

const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g;

function stripHex(text: string): string {
  return text.replace(HEX_RE, "the brand color");
}

/**
 * Compose a clean, layered prompt for Gemini 3.1 Flash Image. The order
 * matters — LLMs weight early tokens heavier — so the post-specific creative
 * direction leads, followed by the brand design language, then the platform
 * playbook, then a thin constraints block.
 *
 * No hex codes appear anywhere in the returned string. Colors are described
 * qualitatively via the synthesis. The base prompt is sanitized of any hex
 * codes it may contain.
 */
export function buildImagePrompt(input: BuildImagePromptInput): string {
  const sections: string[] = [];

  // 1. Creative direction (post-specific)
  const sanitizedBase = stripHex(input.basePrompt);
  const pillarLabel = input.post?.pillar ? `\nContent pillar: ${input.post.pillar}` : "";
  const langLabel = input.post?.language ? `\nLanguage of any visible text: ${input.post.language}` : "";
  sections.push(
    `## Creative direction\n` +
      `${sanitizedBase}${pillarLabel}${langLabel}\n\n` +
      `This is a complete, ready-to-post social media image — not a placeholder, abstract background, ` +
      `or generic stock. Treat it like work a senior social media designer would ship.`,
  );

  // 2. Brand design language (synthesis if present, else brand identity fallback)
  const synthesisMd = flattenSynthesis(input.synthesis);
  if (synthesisMd) {
    sections.push(synthesisMd);
  } else if (input.brandIdentity) {
    const fallback: string[] = ["## Brand design language"];
    if (input.brandIdentity.visual_style) {
      fallback.push(`### Visual style\n${input.brandIdentity.visual_style}`);
    }
    if (input.brandIdentity.design_elements) {
      fallback.push(`### Design elements\n${input.brandIdentity.design_elements}`);
    }
    if (input.brandIdentity.background_style) {
      fallback.push(`### Background\n${input.brandIdentity.background_style}`);
    }
    if (input.brandIdentity.tone_of_voice) {
      fallback.push(`### Tone\n${input.brandIdentity.tone_of_voice}`);
    }
    if (input.brandIdentity.font_family) {
      fallback.push(`### Typography\nPrefer ${input.brandIdentity.font_family}-style typography or a close-feel sans alternative.`);
    }
    if (fallback.length > 1) sections.push(fallback.join("\n\n"));
  }

  // 3. Platform & format playbook
  const playbook = getPlaybookEntry(input.platform, input.format);
  sections.push(renderPlaybookSection(playbook, input.platform, input.format));

  // 4. Composition checklist (carousel context, if any)
  if (input.slideContext) {
    const { index, total } = input.slideContext;
    if (index === 0) {
      sections.push(
        `## Slide context\nThis is slide 1 of ${total} (cover/hook). ` +
          `Carry the strongest visual idea — interior slides build on this system.`,
      );
    } else {
      sections.push(
        `## Slide context\nThis is slide ${index + 1} of ${total}. ` +
          `Maintain the cover's type scale, color story, and grid. Each interior slide is one clear idea.`,
      );
    }
  }

  // 5. Underlying palette (qualitative only — NO hex codes)
  sections.push(
    `## Underlying palette\n` +
      `Use the brand's primary, secondary, and accent colors as established in the design language above. ` +
      `Apply them per the composition patterns and color usage rules. White and neutral darks are fine for contrast.`,
  );

  // 6. Variant angle (Phase 6 will populate this)
  if (input.variantAngle && input.variantAngle.trim()) {
    sections.push(`## Variant angle\n${input.variantAngle.trim()}`);
  }

  // 7. Hard constraints (short, qualitative)
  sections.push(
    `## Constraints\n` +
      `- No company logos, brand wordmarks, or watermarks — the client adds those later.\n` +
      `- No invented company names or brand text — only use text that appears in the creative direction.\n` +
      `- No hex color codes, RGB values, or any technical color notation visible as text in the image.\n` +
      `- No stock-photo cliché or template-generator look.`,
  );

  return sections.join("\n\n");
}
