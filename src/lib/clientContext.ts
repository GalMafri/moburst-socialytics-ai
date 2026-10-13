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
  reference_pipeline_version?: number;
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

/** The columns a ClientContext is built from. */
export const CLIENT_CONTEXT_COLUMNS = "id, name, brand_identity, design_references, brand_book_file_path, brand_book_url, content_pillars, brief_text, brand_notes, geo, language, timezone, design_style_synthesis";

/** A ClientContext from a clients row selected with CLIENT_CONTEXT_COLUMNS. */
// deno-lint-ignore no-explicit-any
export function buildClientContext(row: Record<string, any> | null | undefined, fallbackId = ""): ClientContext {
  const r = row || {};
  return {
    client_id: r.id || fallbackId,
    client_name: r.name || "Client",
    brand_identity: r.brand_identity || null,
    design_references: Array.isArray(r.design_references) ? (r.design_references as string[]) : [],
    brand_book_file_path: r.brand_book_file_path || null,
    brand_book_url: r.brand_book_url || null,
    content_pillars: Array.isArray(r.content_pillars) ? (r.content_pillars as ContentPillar[]) : [],
    brief_text: r.brief_text || null,
    brand_notes: stripVoicePreset(r.brand_notes),
    geo: parseCsv(r.geo),
    languages: parseCsv(r.language),
    timezone: r.timezone || "UTC",
    design_style_synthesis: r.design_style_synthesis || null,
  };
}
