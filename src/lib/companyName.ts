// A company's name, for reading.
//
// RivalIQ stores whatever the person who built the landscape typed, and for a
// good number of competitors that is the website: "reyeslaw.com",
// "cruzfirm.com", "attorneykennugent.com/". A report that lists three brands
// and a URL reads as a mistake, so the domain is turned back into a name
// before it is shown. The original is kept for the tooltip and for anything
// that has to match on the stored value.

/** Words that end a company name and are worth splitting off a domain. */
const TAIL_WORDS = [
  "law", "legal", "firm", "attorneys", "attorney", "lawyers", "lawyer", "injury",
  "group", "partners", "associates", "agency", "media", "digital", "studio", "studios",
  "labs", "lab", "tech", "software", "systems", "solutions", "health", "healthcare",
  "care", "clinic", "dental", "realty", "homes", "insurance", "capital", "financial",
  "bank", "pro", "app", "hq", "co", "company", "global", "world", "online", "shop",
  "store", "market", "games", "gaming", "sports", "fitness", "travel", "network",
];
/** Words that open a company name the same way. */
const HEAD_WORDS = ["attorney", "attorneys", "lawyer", "lawyers", "dr", "the"];

const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/?#].*)?$/i;

function titleCase(word: string): string {
  if (!word) return word;
  // Words that are already mixed case were typed deliberately (iPhone, LegaBot).
  if (/[a-z]/.test(word) && /[A-Z]/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Splits a run-together label on the business words it starts or ends with:
 * "reyeslaw" → ["reyes", "law"], "attorneykennugent" → ["attorney", "kennugent"].
 * A stem shorter than three characters is left alone — "colaw" is not "co law".
 */
function splitOnBusinessWords(token: string): string[] {
  const lower = token.toLowerCase();
  for (const tail of TAIL_WORDS) {
    if (lower.length > tail.length + 2 && lower.endsWith(tail)) {
      return [...splitOnBusinessWords(token.slice(0, -tail.length)), tail];
    }
  }
  for (const head of HEAD_WORDS) {
    if (lower.length > head.length + 2 && lower.startsWith(head)) {
      return [head, ...splitOnBusinessWords(token.slice(head.length))];
    }
  }
  return [token];
}

/**
 * The name to show for a company.
 *
 * Anything that is not a bare domain comes back untouched — a real name, with
 * its own capitals and punctuation, is never second-guessed.
 */
export function displayCompanyName(raw: string | null | undefined): string {
  const value = String(raw || "").trim();
  if (!value) return "";

  const m = value.match(DOMAIN);
  if (!m) return value;

  // Drop the TLD, and any country code sitting behind it (.co.uk).
  const parts = m[1].toLowerCase().split(".");
  while (parts.length > 1 && parts[parts.length - 1].length <= 3) parts.pop();
  const stem = parts.join(" ");
  if (!stem) return value;

  return stem
    .split(/[\s\-_]+/)
    .flatMap((token) => splitOnBusinessWords(token))
    .filter(Boolean)
    .map(titleCase)
    .join(" ");
}

/** True when the shown name had to be rebuilt, so the original is worth a tooltip. */
export function nameWasDerived(raw: string | null | undefined): boolean {
  const value = String(raw || "").trim();
  return !!value && value !== displayCompanyName(value);
}
