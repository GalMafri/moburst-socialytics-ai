// Client-side mirror of the brand checks the generators run server-side, so a
// designer sees the problem before spending a generation rather than after.
//
// Nothing here blocks a generation: a thin brand still produces a usable draft.
// The generators return the same advice as brand_advice on the response, so the
// point is made before the run and again on the result.

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
    return `${name} has no brand material on file, so designs will be generic rather than on-brand. Upload design references in the client's onboarding (Client Setup → Brief → Design References) and run "Brand design language".`;
  }
  return `${name} has only written brand notes — no design references — so designs follow the description but cannot match the real look. Upload design references in the client's onboarding (Client Setup → Brief → Design References).`;
}

export interface DesignVerdict {
  has_hex_codes?: boolean;
  has_logo?: boolean;
  has_garbled_text?: boolean;
  /** Any readable word at all; a failure only when the design was asked for text-free. */
  has_text?: boolean;
  skipped?: boolean;
}

export function verdictIsDirty(v: DesignVerdict | null | undefined, opts: { expectNoText?: boolean } = {}): boolean {
  if (!v || v.skipped) return false;
  return !!(v.has_hex_codes || v.has_logo || v.has_garbled_text || (opts.expectNoText && v.has_text));
}

/** Plain words for the "refining" toast, so the team knows what was caught. */
export function verdictSummary(v: DesignVerdict): string {
  const bits: string[] = [];
  if (v.has_logo) bits.push("an invented logo");
  if (v.has_garbled_text) bits.push("malformed text");
  if (v.has_text && !v.has_garbled_text) bits.push("lettering where none was asked for");
  if (v.has_hex_codes) bits.push("visible colour codes");
  return bits.join(" and ");
}

/**
 * Correction appended to a retry prompt. Naming the specific failure works far
 * better than repeating the original constraint the model already ignored.
 * Kept in step with correctionFor() in the shared edge-function module.
 */
export function correctionFor(v: DesignVerdict, opts: { expectNoText?: boolean } = {}): string {
  const notes: string[] = [];
  if (opts.expectNoText && v.has_text) {
    notes.push(
      "The previous attempt contained readable words — on a document, a sign, a screen or a prop. " +
        "This image must contain NO lettering of any kind, anywhere, at any size: papers are blank or out of focus, " +
        "screens are dark or abstract, signage is absent. The words are added afterwards by the app.",
    );
  }
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

/**
 * Advice the generators return alongside a design when the client's brand
 * material is thin. Generation is never blocked on it.
 */
export function brandAdviceFrom(payload: unknown): string | null {
  const p = payload as { brand_advice?: string | null } | null;
  return p && typeof p.brand_advice === "string" && p.brand_advice.trim() ? p.brand_advice : null;
}
