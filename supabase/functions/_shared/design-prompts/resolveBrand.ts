// supabase/functions/_shared/design-prompts/resolveBrand.ts

import type { DesignStyleSynthesis } from "./flattenSynthesis.ts";
import { referencesFor } from "./designRefs.ts";

export interface ResolvedBrand {
  brandIdentity: any | null;
  synthesis: DesignStyleSynthesis | null;
  designReferences: string[];
  brandBookPath: string | null;
  pillars: Array<{ name: string; description: string }>;
  briefText: string | null;
  brandNotes: string | null;
  languages: string[];
  geo: string[];
  /** Where the brand material came from, for the generation log. */
  source: "caller" | "database" | "none";
}

/** How much brand material a generation has to work from. */
export interface BrandFooting {
  /** A synthesized design language, or design references the model can see. */
  strong: boolean;
  /** Only prose brand_identity fields — enough to steer, not to anchor. */
  weak: boolean;
  /** Nothing at all: any output would be generic stock. */
  none: boolean;
  reasons: string[];
}

const asArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

function brandIdentityHasContent(bi: any): boolean {
  if (!bi || typeof bi !== "object") return false;
  return ["visual_style", "design_elements", "background_style", "tone_of_voice", "font_family"]
    .some((k) => typeof bi[k] === "string" && bi[k].trim().length > 0);
}

/** Does this synthesis carry any actual guidance, or is it an empty shell? */
function synthesisHasContent(s: any): boolean {
  if (!s || typeof s !== "object") return false;
  return Object.entries(s).some(
    ([k, v]) => k !== "synthesized_at" && k !== "source_count" && typeof v === "string" && v.trim().length > 0,
  );
}

export function footingOf(r: ResolvedBrand): BrandFooting {
  const reasons: string[] = [];
  const hasSynthesis = synthesisHasContent(r.synthesis);
  const hasRefs = r.designReferences.length > 0;
  const hasBook = !!r.brandBookPath;
  const hasIdentity = brandIdentityHasContent(r.brandIdentity);

  if (!hasSynthesis) reasons.push("no synthesized design language");
  if (!hasRefs) reasons.push("no design references");
  if (!hasBook) reasons.push("no brand book");
  if (!hasIdentity) reasons.push("no brand identity fields");

  const strong = hasSynthesis || hasRefs || hasBook;
  const weak = !strong && hasIdentity;
  return { strong, weak, none: !strong && !weak, reasons };
}

/**
 * Work out what brand material a generation actually has.
 *
 * The generators used to trust whatever the caller sent. A caller that forgot
 * `client_context` — a new call site, a retry, a direct API call — produced a
 * perfectly generic image with no warning, because "no brand data" and "brand
 * data that says nothing" looked identical from inside the function. This
 * resolves from the caller first, falls back to the client row, and reports
 * which happened so the log tells the truth.
 */
export async function resolveBrandContext(args: {
  supabase: any;
  clientId?: string | null;
  clientContext?: any;
  /** Legacy top-level fields some callers still send. */
  legacy?: {
    brandIdentity?: any;
    designReferences?: string[];
    brandBookPath?: string | null;
  };
}): Promise<ResolvedBrand> {
  const ctx = args.clientContext || {};
  const legacy = args.legacy || {};

  const fromCaller: ResolvedBrand = {
    brandIdentity: ctx.brand_identity ?? legacy.brandIdentity ?? null,
    synthesis: ctx.design_style_synthesis ?? null,
    designReferences: asArray(ctx.design_references ?? legacy.designReferences),
    brandBookPath: ctx.brand_book_file_path ?? legacy.brandBookPath ?? null,
    pillars: Array.isArray(ctx.content_pillars) ? ctx.content_pillars : [],
    briefText: ctx.brief_text ?? null,
    brandNotes: ctx.brand_notes ?? null,
    languages: asArray(ctx.languages),
    geo: asArray(ctx.geo),
    source: "caller",
  };

  if (footingOf(fromCaller).strong || !args.clientId || !args.supabase) {
    if (footingOf(fromCaller).none) fromCaller.source = "none";
    return fromCaller;
  }

  // The caller gave us nothing solid but we know which client this is, so read
  // the row rather than generating something generic.
  try {
    const { data, error } = await args.supabase
      .from("clients")
      .select(
        "brand_identity, design_references, harvested_design_references, brand_book_file_path, content_pillars, brief_text, brand_notes, geo, language, design_style_synthesis",
      )
      .eq("id", args.clientId)
      .maybeSingle();
    if (error || !data) return fromCaller;

    const fromDb: ResolvedBrand = {
      brandIdentity: fromCaller.brandIdentity ?? data.brand_identity ?? null,
      synthesis: fromCaller.synthesis ?? data.design_style_synthesis ?? null,
      designReferences: fromCaller.designReferences.length
        ? fromCaller.designReferences
        // Staff uploads lead; the weekly harvest of the client's own posts
        // fills the rest, so a generation sees the current work too.
        : referencesFor(data.design_references, (data as any).harvested_design_references, 8),
      brandBookPath: fromCaller.brandBookPath ?? data.brand_book_file_path ?? null,
      pillars: fromCaller.pillars.length
        ? fromCaller.pillars
        : Array.isArray(data.content_pillars)
          ? (data.content_pillars as any)
          : [],
      briefText: fromCaller.briefText ?? data.brief_text ?? null,
      brandNotes: fromCaller.brandNotes ?? data.brand_notes ?? null,
      languages: fromCaller.languages.length
        ? fromCaller.languages
        : String(data.language || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      geo: fromCaller.geo.length
        ? fromCaller.geo
        : String(data.geo || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      source: "database",
    };
    if (footingOf(fromDb).none) fromDb.source = "none";
    return fromDb;
  } catch {
    return fromCaller;
  }
}

/**
 * Advice shown when a client has little or nothing to design from. Generation
 * still runs — a designer would rather have a rough draft than a refusal — but
 * the result cannot carry design tokens the client has never given us, so the
 * caller surfaces this alongside it.
 */
export function brandFootingAdvice(footing: BrandFooting, clientName?: string | null): string | null {
  if (footing.strong) return null;
  const who = clientName || "This client";
  if (footing.none) {
    return (
      `${who} has no brand material on file, so this design is generic rather than on-brand. ` +
      `Upload design references in the client's onboarding (Client Setup → Brief → Design References) ` +
      `and run "Brand design language" — every later generation then follows the real look.`
    );
  }
  return (
    `${who} has only written brand notes — no design references — so this design follows the ` +
    `description but cannot match the real look. Upload design references in the client's ` +
    `onboarding (Client Setup → Brief → Design References) for on-brand output.`
  );
}
