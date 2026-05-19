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
  // Reserved for future phases — accepted now so callers don't have to change later.
  // The current builder doesn't use these; richer prompts will pull from them.
  pillars?: Array<{ name: string; description: string }>;
  briefText?: string | null;
  brandNotes?: string | null;
  languages?: string[];
  geo?: string[];
  // End reserved.
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
 * Compose a clean, layered prompt for Gemini 3.1 Flash Image.
 *
 * Order matters — LLMs weight early tokens heavier. When the client has a
 * synthesized design language, that language leads (so the brand IS the
 * anchor); the creative direction follows as the specific application. When
 * no synthesis exists, creative direction leads. This split prevents
 * generic-flavored creative direction text from overriding strong brand
 * patterns.
 *
 * No hex codes appear anywhere in the returned string. Colors are described
 * qualitatively via the synthesis. The base prompt is sanitized of any hex
 * codes it may contain.
 */
export function buildImagePrompt(input: BuildImagePromptInput): string {
  const sections: string[] = [];

  const synthesisMd = flattenSynthesis(input.synthesis);
  const hasStrongBrand = !!synthesisMd;

  // 0. Primary objective — sets the model's priority order before anything else.
  if (hasStrongBrand) {
    sections.push(
      `## Primary objective\n` +
        `Produce a single ready-to-post social media graphic that visually belongs to this ` +
        `client's brand. The BRAND DESIGN LANGUAGE section below is the binding style guide — ` +
        `composition, typography, imagery, color usage, surface, logo treatment, mood, and ` +
        `platform adaptations are NOT suggestions. The creative direction tells you WHAT the ` +
        `post is about; the brand design language tells you HOW it must look.`,
    );
  } else {
    sections.push(
      `## Primary objective\n` +
        `Produce a single ready-to-post social media graphic with the look and feel of work ` +
        `a senior in-house designer would ship. Not a stock template, not abstract decoration.`,
    );
  }

  const sanitizedBase = stripHex(input.basePrompt);
  const pillarLabel = input.post?.pillar ? `\nContent pillar: ${input.post.pillar}` : "";
  const langLabel = input.post?.language ? `\nLanguage of any visible text: ${input.post.language}` : "";

  // 1. BRAND DESIGN LANGUAGE first when present — it's the binding style guide.
  //    Otherwise creative direction leads.
  if (hasStrongBrand) {
    sections.push(
      `## BRAND DESIGN LANGUAGE — REQUIRED STYLE\n` +
        `Every choice (layout, typography, imagery treatment, color application, surface, ` +
        `logo handling, mood) MUST follow the rules below. Treat each section as a hard ` +
        `requirement, not a description. If any rule conflicts with the creative direction, ` +
        `apply the rule — translate the creative direction to fit the brand, not the other way.\n\n` +
        synthesisMd.replace(/^## Brand design language\n?/, ""),
    );
    sections.push(
      `## Creative direction (what to depict)\n` +
        `${sanitizedBase}${pillarLabel}${langLabel}\n\n` +
        `Apply the BRAND DESIGN LANGUAGE above to render this brief. The brief tells you the ` +
        `subject and concept; the language above dictates the execution.`,
    );
  } else if (input.brandIdentity) {
    // No synthesis — fall back to brand_identity fields, then creative direction.
    sections.push(
      `## Creative direction\n` +
        `${sanitizedBase}${pillarLabel}${langLabel}\n\n` +
        `This is a complete, ready-to-post social media image — not a placeholder, abstract ` +
        `background, or generic stock. Treat it like work a senior social media designer would ship.`,
    );
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
  } else {
    // No synthesis, no brand identity — creative direction stands alone.
    sections.push(
      `## Creative direction\n` +
        `${sanitizedBase}${pillarLabel}${langLabel}\n\n` +
        `This is a complete, ready-to-post social media image — not a placeholder, abstract ` +
        `background, or generic stock. Treat it like work a senior social media designer would ship.`,
    );
  }

  // 3. Platform & format playbook
  const playbook = getPlaybookEntry(input.platform, input.format);
  sections.push(renderPlaybookSection(playbook, input.platform, input.format));

  // 4. Slide context — when this call is for ONE slide of an N-slide carousel.
  //    This section must be unambiguous: each Gemini call returns ONE image of
  //    ONE slide. Without this language, Gemini happily composes a "contact
  //    sheet" showing all N slides in a grid, which defeats the entire point.
  if (input.slideContext) {
    const { index, total } = input.slideContext;
    const slideRole =
      index === 0
        ? `slide 1 of ${total} — the COVER / hook. A single magazine-cover composition: a strong headline + one supporting visual idea. No numbered list, no preview of upcoming slides.`
        : `slide ${index + 1} of ${total} — an INTERIOR slide. One clear idea, different content from the cover but the same visual system. No "next slide" preview, no slide counter, no thumbnail strip.`;

    sections.push(
      `## SINGLE-SLIDE OUTPUT — MANDATORY\n` +
        `You are generating ${slideRole}\n\n` +
        `Output ONE image that fills the entire canvas with this single slide's content. Hard rules:\n` +
        `- DO NOT show multiple slides in one image.\n` +
        `- DO NOT compose a grid, contact sheet, mosaic, storyboard, or multi-panel layout.\n` +
        `- DO NOT show thumbnails or previews of other slides.\n` +
        `- DO NOT label this image "1 of ${total}" or include any slide-number text overlays unless the creative direction explicitly asks for them.\n` +
        `- Treat this as a standalone post — every pixel is one slide's content.\n` +
        `The remaining ${total - 1} slide${total - 1 === 1 ? "" : "s"} ${total - 1 === 1 ? "is" : "are"} being generated separately by other calls; do not include them here.`,
    );
  }

  // 5. Underlying palette (qualitative only — NO hex codes)
  // Only emit when there's an actual design language section above to reference.
  const hasDesignLanguage = !!synthesisMd || !!input.brandIdentity;
  if (hasDesignLanguage) {
    sections.push(
      `## Underlying palette\n` +
        `Use the brand's primary, secondary, and accent colors as established in the design language above. ` +
        `Apply them per the composition patterns and color usage rules. White and neutral darks are fine for contrast.`,
    );
  }

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
