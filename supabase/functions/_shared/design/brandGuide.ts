// supabase/functions/_shared/design/brandGuide.ts
//
// What a design is planned from besides the client's posts (Social AI sync,
// 18 Nov 2026, Sinéad): the brand book, which wins where the brand's look has
// changed since its posts (a rebrand, like Bader Law's), and the client's
// content strategy, kept as a lasting reference for every design. An
// uploaded strategy document's own look (design-request/strategyDocLook.ts) comes after the
// brand book and before the posts.
//
// The brand book is read once, when it is uploaded in Client Setup
// (extract-brand-from-file), into the client's brand identity. Those fields
// count as the brand book's only while a brand book is on file: without one,
// the identity came from web research or a person's guess, and the posts stay
// the only guide to the look. Nothing here makes a paid call.

const BOOK_FIELDS: Array<[string, string]> = [
  ["visual_style", "Visual style"],
  ["design_elements", "Design elements"],
  ["background_style", "Backgrounds"],
  ["font_family", "Typeface"],
  ["logo_description", "Logo"],
];

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_FIELD = 400;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, MAX_FIELD) : "";
}

/** The brand book's rules as plain lines, or "" when the client has no brand book or nothing was read from it. */
export function brandBookRules(identity: unknown, brandBookPath: string | null | undefined): string {
  if (!brandBookPath || !identity || typeof identity !== "object") return "";
  const id = identity as Record<string, unknown>;
  const colours = [["primary", id.primary_color], ["secondary", id.secondary_color], ["accent", id.accent_color]]
    .map(([name, v]) => [name, text(v)] as const)
    .filter(([, v]) => HEX.test(v))
    .map(([name, v]) => `${name} ${v}`);
  const lines = [
    colours.length ? `- Colours: ${colours.join(", ")}` : "",
    ...BOOK_FIELDS.map(([key, label]) => (text(id[key]) ? `- ${label}: ${text(id[key])}` : "")),
  ].filter(Boolean);
  return lines.join("\n");
}

/** The planner's lines for the brand book, the strategy document's look and the strategy; "" when there is none, so a plan reads as it always did. */
export function brandGuideLines(brand: string, guide: { brandBook?: string | null; strategy?: string | null; strategyDocLook?: string | null }): string {
  const book = String(guide.brandBook ?? "").trim();
  const strategy = String(guide.strategy ?? "").trim();
  const docLook = String(guide.strategyDocLook ?? "").trim();
  return [
    book
      ? `${brand}'s brand book:\n${book}\nWhere the brand book and the posts differ, the brand has changed its look since those posts: every option's picture, colours and type follow the brand book, and keep the layout of the posts you chose.`
      : "",
    docLook
      ? `How ${brand}'s strategy document says its posts should look:\n${docLook}\nEvery option follows this look where it differs from the posts${book ? "; where it differs from the brand book, the brand book wins" : ""}.`
      : "",
    strategy ? `${strategy}\nEvery option serves this strategy: it speaks to its audience, fits its positioning and shows nothing it says to avoid.` : "",
  ].filter(Boolean).join("\n");
}
