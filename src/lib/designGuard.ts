// Client-side mirror of the brand checks the generators run server-side, so a
// designer sees the problem before spending a generation rather than after.
//
// The server is still the authority: it refuses a generation with no footing
// and returns code "no_brand_footing". This is the earlier, friendlier warning.

import type { ClientContext } from "@/lib/clientContext";

export interface BrandFooting {
  /** A synthesized design language, design references, or a brand book. */
  strong: boolean;
  /** Only prose brand fields — enough to steer, not enough to anchor. */
  weak: boolean;
  /** Nothing to design from; output would be generic stock. */
  none: boolean;
  /** What is missing, for the warning text. */
  gaps: string[];
}

function synthesisHasContent(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  return Object.entries(s as Record<string, unknown>).some(
    ([k, v]) => k !== "synthesized_at" && k !== "source_count" && typeof v === "string" && v.trim().length > 0,
  );
}

function identityHasContent(bi: unknown): boolean {
  if (!bi || typeof bi !== "object") return false;
  const o = bi as Record<string, unknown>;
  return ["visual_style", "design_elements", "background_style", "tone_of_voice", "font_family"].some(
    (k) => typeof o[k] === "string" && (o[k] as string).trim().length > 0,
  );
}

export function brandFooting(ctx: ClientContext | null | undefined): BrandFooting {
  const hasSynthesis = synthesisHasContent(ctx?.design_style_synthesis);
  const hasRefs = (ctx?.design_references?.length ?? 0) > 0;
  const hasBook = !!ctx?.brand_book_file_path || !!(ctx as any)?.brand_book_url;
  const hasIdentity = identityHasContent(ctx?.brand_identity);

  const gaps: string[] = [];
  if (!hasSynthesis) gaps.push("no design language");
  if (!hasRefs) gaps.push("no design references");
  if (!hasBook) gaps.push("no brand book");
  if (!hasIdentity) gaps.push("no brand identity");

  const strong = hasSynthesis || hasRefs || hasBook;
  const weak = !strong && hasIdentity;
  return { strong, weak, none: !strong && !weak, gaps };
}

/** One line for the dialog, or null when the client is properly set up. */
export function brandWarning(ctx: ClientContext | null | undefined): string | null {
  const f = brandFooting(ctx);
  if (f.strong) return null;
  const name = ctx?.client_name || "This client";
  if (f.none) {
    return `${name} has nothing to design from (${f.gaps.join(", ")}). Add design references or a brand book in Client Setup and run "Brand design language" — generating now would return generic stock art.`;
  }
  return `${name} has no design references, brand book or synthesized design language — only written brand notes. Designs will follow the description but cannot match the real look. Add references in Client Setup for on-brand output.`;
}

export interface DesignVerdict {
  has_hex_codes?: boolean;
  has_logo?: boolean;
  has_garbled_text?: boolean;
  skipped?: boolean;
}

export function verdictIsDirty(v: DesignVerdict | null | undefined): boolean {
  return !!v && !v.skipped && !!(v.has_hex_codes || v.has_logo || v.has_garbled_text);
}

/** Plain words for the "refining" toast, so the team knows what was caught. */
export function verdictSummary(v: DesignVerdict): string {
  const bits: string[] = [];
  if (v.has_logo) bits.push("an invented logo");
  if (v.has_garbled_text) bits.push("malformed text");
  if (v.has_hex_codes) bits.push("visible colour codes");
  return bits.join(" and ");
}

/**
 * Correction appended to a retry prompt. Naming the specific failure works far
 * better than repeating the original constraint the model already ignored.
 * Kept in step with correctionFor() in the shared edge-function module.
 */
export function correctionFor(v: DesignVerdict): string {
  const notes: string[] = [];
  if (v.has_logo) {
    notes.push(
      "The previous attempt rendered a logo, wordmark or brand insignia. Render NO logo, no wordmark, no monogram and no badge of any kind. Leave the area where a logo would sit visually clear — the real logo is composited in afterwards.",
    );
  }
  if (v.has_garbled_text) {
    notes.push(
      "The previous attempt contained malformed or nonsensical text. Use only short, correctly spelled words taken from the brief, or no text at all. Never invent lettering.",
    );
  }
  if (v.has_hex_codes) {
    notes.push(
      "The previous attempt showed colour codes as readable text. Never render hex codes, RGB values or any technical colour notation — colour is applied visually only.",
    );
  }
  if (notes.length === 0) return "";
  return `\n\nCRITICAL CORRECTIONS — the previous attempt failed review:\n- ${notes.join("\n- ")}`;
}

/** The server's refusal, surfaced as-is when it comes back. */
export function noBrandFootingError(payload: unknown): string | null {
  const p = payload as { code?: string; error?: string } | null;
  return p && p.code === "no_brand_footing" && p.error ? p.error : null;
}
