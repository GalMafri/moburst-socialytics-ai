// src/lib/clientContext.ts
// Single shape for everything a generation call needs to know about the client.
// Built once in ReportView (or wherever the client row is fetched) and passed
// down through props.

import type { BrandIdentity } from "@/components/reports/CreatePostDesignButton";

export interface ClientContext {
  client_id: string;
  client_name: string;
  brand_identity: BrandIdentity | null;
  design_references: string[];          // storage paths in design-references bucket
  brand_book_file_path: string | null;  // storage path in brand-books bucket
  brand_book_url: string | null;
  content_pillars: ContentPillar[];
  brief_text: string | null;
  brand_notes: string | null;           // may contain [VOICE:preset]\n prefix
  geo: string[];                        // parsed from comma-separated
  languages: string[];                  // parsed from comma-separated
  timezone: string;
  design_style_synthesis: DesignStyleSynthesis | null;
}

export interface ContentPillar {
  name: string;
  description: string;
}

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
  synthesized_at?: string;             // ISO timestamp
  source_count?: number;               // how many refs were used
}

/**
 * Parse a comma-separated string into an array, trimming and filtering empties.
 * Handles strings like "US, UK" → ["US", "UK"]. Returns an empty array for
 * null/empty input.
 */
export function parseCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Strip the [VOICE:preset] prefix from brand_notes if present.
 * The voice preset is stored separately; brand_notes is the freeform notes only.
 */
export function stripVoicePreset(brandNotes: string | null | undefined): string | null {
  if (!brandNotes) return null;
  return brandNotes.replace(/^\[VOICE:[^\]]+]\n?/, "") || null;
}
