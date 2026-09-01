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
      // The logo section describes where the REAL logo lives so the layout
      // reserves that zone — but generated logos come out garbled, and the
      // global constraint says the client adds the real one later. Without
      // this qualifier the two instructions contradict each other and image
      // models resolve the conflict unpredictably.
      if (key === "logo_and_marks_treatment") {
        sections.push(
          `### ${label} (PLACEMENT AWARENESS ONLY — do NOT render any logo, wordmark, or brand insignia; keep this zone visually clear so the real logo can be added later)\n${value.trim()}`,
        );
        continue;
      }
      sections.push(`### ${label}\n${value.trim()}`);
    }
  }
  if (sections.length === 0) return "";
  return [`## Brand design language`, ...sections].join("\n\n");
}
