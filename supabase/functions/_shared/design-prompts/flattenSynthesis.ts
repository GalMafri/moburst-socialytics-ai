// supabase/functions/_shared/design-prompts/flattenSynthesis.ts

export interface DesignStyleSynthesis {
  composition_patterns?: string;
  typography_treatment?: string;
  imagery_style?: string;
  color_usage?: string;
  surface_and_texture?: string;
  logo_and_marks_treatment?: string;
  mood_and_voice_visual?: string;
  anti_patterns?: string;
  platform_adaptations?: string;
  synthesized_at?: string;
  source_count?: number;
}

const SECTION_LABELS: Array<[keyof DesignStyleSynthesis, string]> = [
  ["composition_patterns", "Composition"],
  ["typography_treatment", "Typography"],
  ["imagery_style", "Imagery"],
  ["color_usage", "Color usage"],
  ["surface_and_texture", "Surface & texture"],
  ["logo_and_marks_treatment", "Logo & marks"],
  ["mood_and_voice_visual", "Mood"],
  ["platform_adaptations", "Platform adaptations"],
  ["anti_patterns", "Anti-patterns (avoid)"],
];

/**
 * Render the synthesis JSON object as a labelled markdown section for prompt
 * injection. Skips empty fields. Returns an empty string if no synthesis is
 * present so callers can decide whether to fall back.
 */
const MARK_WORDS = /\b(logo|logos|lockup|monogram|lettermark|wordmark|watermark|brand mark|insignia|end-card)\b/i;

/**
 * Drops every sentence that talks about the client's marks. The synthesis is
 * learned from the client's own posts, which carry a logo, a monogram
 * watermark and a lockup; the generated image must carry none of them, and a
 * model told "the watermark lives behind the text zone" will draw one.
 */
function withoutMarkSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !MARK_WORDS.test(s))
    .join(" ")
    .trim();
}

/**
 * Render the synthesis JSON object as a labelled markdown section for prompt
 * injection. Skips empty fields, and the logo section entirely. Returns an
 * empty string if no synthesis is present so callers can decide whether to
 * fall back.
 */
export function flattenSynthesis(s: DesignStyleSynthesis | null | undefined): string {
  if (!s) return "";
  const sections: string[] = [];
  for (const [key, label] of SECTION_LABELS) {
    if (key === "logo_and_marks_treatment") continue;
    const value = s[key];
    if (typeof value === "string" && value.trim().length > 0) {
      const cleaned = withoutMarkSentences(value);
      if (cleaned) sections.push(`### ${label}\n${cleaned}`);
    }
  }
  if (sections.length === 0) return "";
  sections.push(
    `### Marks\nThe client's published designs carry a logo, a monogram watermark and a bottom lockup. This image carries NONE of them: no logo, no monogram, no watermark, no lockup, no initials as texture. Where the references put a mark, leave the ground plain in the brand's colour.`,
  );
  return [`## Brand design language`, ...sections].join("\n\n");
}
