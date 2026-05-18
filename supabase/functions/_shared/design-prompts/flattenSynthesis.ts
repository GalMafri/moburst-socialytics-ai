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
export function flattenSynthesis(s: DesignStyleSynthesis | null | undefined): string {
  if (!s) return "";
  const sections: string[] = [];
  for (const [key, label] of SECTION_LABELS) {
    const value = s[key];
    if (typeof value === "string" && value.trim().length > 0) {
      sections.push(`### ${label}\n${value.trim()}`);
    }
  }
  if (sections.length === 0) return "";
  return [`## Brand design language`, ...sections].join("\n\n");
}
