// supabase/functions/_shared/design/brandLook.ts
//
// The facts the app holds about a client's colors, as the planner of a
// design is given them (17 Nov 2026). A design takes only the look from the
// client's own posts (colors, type treatment, layout style), built on the
// look most of them share; a post that looks unlike the others is a one-off
// (canva/options.ts, sharedLookRule). Which posts share the look is the
// planner's reading of the posts it is shown. These facts anchor that
// reading: they are read from the client's rows as they are, and nothing
// here measures a post.
//
// Free of Deno and network imports so it can be tested.

export interface BrandColors {
  /** The brand's colors on file (clients.brand_identity: primary, secondary, accent). */
  brand: string[];
  /** The colors of the logo file's whole parts (design_brand_settings.logo_set.inks). */
  logo: string[];
  /** The ground the client's own posts show the logo on (logo_set.canvas, when its posts gave it). */
  logoGround: string | null;
  /** The background the client's designs start from, when it is the brand's or a person's choice. */
  background: string | null;
}

const hexOf = (value: unknown): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  return m ? `#${m[1].toUpperCase()}` : null;
};

const rgbHex = (value: unknown): string | null => {
  if (!Array.isArray(value) || value.length !== 3 || value.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return `#${(value as number[]).map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};

const once = (list: Array<string | null>): string[] => [...new Set(list.filter((c): c is string => !!c))];

/** Most logo colors named: a logo of many parts is not listed part by part. */
const MAX_LOGO_COLORS = 4;

/**
 * The colors on a client's rows, each as #RRGGBB, each once. Anything that is
 * not a color is left out. The logo's colors and its ground are read only
 * from a set made for the logo file the row holds now. The background is
 * left out when it is only a neutral chosen for the logo to show on
 * (derived.background_from "neutral"): that says nothing of the brand.
 */
export function brandColors(settings: unknown, identity: unknown): BrandColors {
  const row = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const id = identity && typeof identity === "object" ? identity as Record<string, unknown> : {};
  const set = row.logo_set && typeof row.logo_set === "object" ? row.logo_set as Record<string, unknown> : null;
  const current = !!set && typeof row.logo_path === "string" && set.of === row.logo_path;
  const canvas = current && set!.canvas && typeof set!.canvas === "object" ? set!.canvas as Record<string, unknown> : null;
  const derived = row.derived && typeof row.derived === "object" ? row.derived as Record<string, unknown> : {};
  return {
    brand: once([id.primary_color, id.secondary_color, id.accent_color].map(hexOf)),
    logo: once(current && Array.isArray(set!.inks) ? (set!.inks as unknown[]).map(rgbHex) : []).slice(0, MAX_LOGO_COLORS),
    logoGround: canvas?.from === "client_posts" ? hexOf(canvas.ground) : null,
    background: derived.background_from === "neutral" ? null : hexOf(row.background),
  };
}

const listed = (colors: string[]): string => (colors.length > 1 ? `${colors.slice(0, -1).join(", ")} and ${colors[colors.length - 1]}` : colors[0] ?? "");

/** The planner's line of color facts, or "" when the app holds none. */
export function brandColorsLine(brand: string, c: BrandColors): string {
  const facts = [
    c.brand.length ? `its brand colors are ${listed(c.brand)}` : "",
    c.logo.length ? `its logo is in ${listed(c.logo)}` : "",
    c.logoGround ? `its posts show the logo on ${c.logoGround}` : "",
    c.background ? `its designs start from a ${c.background} background` : "",
  ].filter(Boolean);
  if (!facts.length) return "";
  return `What the app holds about ${brand}'s colors: ${facts.join("; ")}. ` +
    "Use them to tell the shared look from a one-off: when most of the posts are in these colors, a post whose grounds, bands and type are in none of them is a one-off.";
}
