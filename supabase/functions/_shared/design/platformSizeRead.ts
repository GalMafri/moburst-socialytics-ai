// supabase/functions/_shared/design/platformSizeRead.ts
//
// Reading Sprout Social's image sizes guide, and deciding what a read
// changes (17 Nov 2026, spec
// docs/superpowers/specs/2026-11-17-platform-sizes-design.md, section 3).
// The weekly job (platformSizeRefresh.ts) fetches the page and asks a model
// to pick the post sizes out of it; everything that decides is here, in
// code, on exact facts:
//
//   the text     the page's article as plain text, with its headings, its
//                table rows and its list items kept apart;
//   the parts    the cheat sheet's row for a platform and the platform's
//                own section, found by their headings;
//   on the page  the cheat sheet's cell is read by the code itself; a size
//                the model names from a section counts only when it is
//                written in that platform's section;
//   the outcome  what a row's read changes: nothing, or a pending size
//                that becomes the size when the next read gives it again.
//                No size is ever written on one read.
//
// The reading rule. For an image or a carousel: first the cheat sheet's
// "Primary post image" cell for the platform, sizes in the order written,
// then the platform's own section, in the order the model lists them. For a
// Story: the platform's Stories part. The cheat sheet wins over the section
// and the first listed wins within a part when a new size is chosen. A size
// in use stays while the guide still lists it in either part, so a platform
// with two recommended shapes never flips between them.
//
// Free of Deno and network imports.

import { networkKey } from "../sprout/publishRules.ts";
import { UPLOAD_FORMATS, checkSize, sameSize, type Size, type UploadFormat } from "./platformSize.ts";

/** The guide. Sprout is where this team publishes, so its guide is the source. */
export const GUIDE_URL = "https://sproutsocial.com/insights/social-media-image-sizes-guide/";
/** A page with less text than this is not the guide (a block page, an empty answer). On 17 Nov 2026 the guide had 41,800 characters. */
export const MIN_GUIDE_CHARS = 1500;
/** The most text sent to the model. */
export const MAX_GUIDE_CHARS = 90_000;

export type Part = "cheat_sheet" | "section";
export interface Key { platform: string; format: UploadFormat }
export interface ReadSize extends Size { part: Part }
/** A row of platform_sizes as the job reads it. */
export interface SizeRow extends Key, Size {
  pending_width: number | null; pending_height: number | null;
  previous_width?: number | null; previous_height?: number | null;
  /** False: the image model refused the size and there was no drawn size to go back to. */
  usable?: boolean | null;
}
/** A row of platform_size_outcomes: what the image model did with a size. */
export interface SizeOutcomeRow extends Key, Size { drawn_at: string | null; refusal_confirmed_at: string | null }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", times: "×", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'" };
function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}
const bare = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * The page's article as text. A heading is a line that starts with as many
 * "#" as its level; a table row is one line with " | " between its cells; a
 * list item is a line that starts with "- ". Scripts, styles and drawings
 * are left out. With no article element the whole page is read.
 */
export function guideText(html: string): string {
  let a = /<article[\s\S]*<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*<\/main>/i.exec(html)?.[0] ?? html;
  a = a.replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  a = a.replace(/<tr\b[\s\S]*?<\/tr>/gi, (row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]);
    // A row of one cell is a box around ordinary text (the guide sets each platform's guidelines in one): its lines are kept.
    if (cells.length === 1) return `\n${cells[0]}\n`;
    return cells.length ? `\n${cells.map(bare).join(" | ")}\n` : "\n";
  });
  a = a.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, inner) => `\n\n${"#".repeat(Number(n))} ${bare(inner)}\n`);
  a = a.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/(p|li|div|ul|ol|table|section|figure|blockquote)>|<br\s*\/?>/gi, "\n");
  const text = decode(a.replace(/<[^>]+>/g, " "));
  return text.split("\n").map((l) => l.replace(/[ \t\r\f\v\u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The page's own "modified" date (its structured data), as YYYY-MM-DD, or null. */
export function guideUpdated(html: string): string | null {
  return /"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ?? null;
}

/** Every size written in a text ("1080×1350", "1080 x 1350", "1,080 x 1,350"), in the order written. */
export function sizesIn(text: string): Size[] {
  const out: Size[] = [];
  for (const m of text.matchAll(/(?<![\d.,])(\d{1,2},\d{3}|\d{3,4})\s*(?:px|pixels)?\s*[×xX]\s*(\d{1,2},\d{3}|\d{3,4})(?!\d|[.,]\d)/g)) {
    out.push({ width: Number(m[1].replace(",", "")), height: Number(m[2].replace(",", "")) });
  }
  return out;
}

type Heading = { level: number; text: string; line: number };

/**
 * The parts of the guide the sizes are read from.
 *
 *   cheat     per platform, the "Primary post image" cell of its row in the
 *             table under the heading that contains "cheat sheet";
 *   section   per platform, the text from the first heading that names the
 *             platform (at the cheat sheet's level, 2 when there is none)
 *             to the next heading of that level or above.
 *
 * A platform is named by networkKey, the publish path's own rule.
 */
export function guideParts(text: string): { cheat: Map<string, string>; section: Map<string, string> } {
  const lines = text.split("\n");
  const headings: Heading[] = [];
  lines.forEach((l, i) => {
    const m = /^(#{1,6}) (.*)$/.exec(l);
    if (m) headings.push({ level: m[1].length, text: m[2], line: i });
  });
  const end = (h: Heading) => headings.find((o) => o.line > h.line && o.level <= h.level)?.line ?? lines.length;
  const cheat = new Map<string, string>();
  const sheet = headings.find((h) => /cheat\s*sheet/i.test(h.text));
  if (sheet) {
    const rows = lines.slice(sheet.line + 1, end(sheet)).filter((l) => l.includes(" | ")).map((l) => l.split(" | ").map((c) => c.trim()));
    const head = rows.find((r) => r.some((c) => /primary post image/i.test(c)));
    const col = head ? head.findIndex((c) => /primary post image/i.test(c)) : -1;
    if (col > 0) {
      for (const r of rows) {
        if (r === head || r.length <= col) continue;
        const key = networkKey(r[0]);
        if (/^[a-z]+$/.test(key) && !cheat.has(key)) cheat.set(key, r[col]);
      }
    }
  }
  const section = new Map<string, string>();
  const level = sheet?.level ?? 2;
  for (const h of headings) {
    if (h.level !== level || h === sheet) continue;
    const key = networkKey(h.text);
    // A heading names a platform when its key is one word: any other heading comes back whole.
    if (!/^[a-z]+$/.test(key) || section.has(key)) continue;
    section.set(key, lines.slice(h.line, end(h)).join("\n"));
  }
  return { cheat, section };
}

/**
 * The tool whose input is the strict structure the model answers in. The
 * model is asked to call it, never made to (platformSizeRefresh.ts,
 * extractRequest); `strict` has the API hold the call's input to this
 * schema, and parseExtract checks the answer again whichever way it came.
 */
export const EXTRACT_TOOL = {
  name: "record_sizes",
  description: "Record the organic post image sizes the guide recommends, for exactly the rows asked for. Call it exactly once, with every row.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false, required: ["rows"],
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["platform", "format", "sizes"],
          properties: {
            platform: { type: "string" },
            format: { type: "string", enum: [...UPLOAD_FORMATS] },
            sizes: {
              type: "array",
              items: {
                type: "object", additionalProperties: false, required: ["width", "height", "part"],
                properties: { width: { type: "integer" }, height: { type: "integer" }, part: { type: "string", enum: ["cheat_sheet", "section"] } },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** The instruction: the rows to read and the reading rule, then the page's text. */
export function extractPrompt(keys: Key[], text: string): string {
  return [
    "Below is the text of a guide to social media image sizes. A line that starts with # is a heading, a line with | between its parts is a table row, a line that starts with - is a list item.",
    "Read the image sizes for organic posts, for exactly these rows:",
    ...keys.map((k) => `- platform "${k.platform}", format "${k.format}"`),
    "For each row, list the sizes the guide recommends, in pixels, in this order:",
    '1. For "image" and "carousel": the sizes in the "Primary post image" cell of the platform\'s row in the cheat sheet table, in the order written, each with part "cheat_sheet".',
    '2. Then the recommended sizes for that kind of post in the platform\'s own section of the guide, in the order written, each with part "section". For "image": the feed, timeline, shared or in-stream image post. For "carousel": only a part whose heading names carousel posts. For "story": the platform\'s Stories image part, and nothing from the cheat sheet.',
    "Leave out everything else: ads, profile pictures, cover and banner images, thumbnails, video, Reels, link previews with no size of their own, minimum and maximum sizes, safe areas and grid views.",
    "Copy each size exactly as the guide writes it. When the guide gives no size for a row, give that row an empty list. Add no row that was not asked for.",
    `Answer by calling the ${EXTRACT_TOOL.name} tool exactly once, with every row. Do not answer in words.`,
    "",
    "The guide:",
    '"""',
    text.slice(0, MAX_GUIDE_CHARS),
    '"""',
  ].join("\n");
}

const keyOf = (k: Key) => `${k.platform}/${k.format}`;

/**
 * The model's answer as the strict structure, or null when it is not one
 * (the read then fails as a whole). Rows that were not asked for are
 * dropped, the first answer for a row is the one kept, and a size that is
 * not two whole numbers with a known part is dropped. A row asked for and
 * not answered is absent from the map.
 */
export function parseExtract(raw: unknown, keys: Key[]): Map<string, ReadSize[]> | null {
  const rows = (raw as { rows?: unknown } | null)?.rows;
  if (!raw || typeof raw !== "object" || !Array.isArray(rows)) return null;
  const asked = new Set(keys.map(keyOf));
  const out = new Map<string, ReadSize[]>();
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object" || typeof r.platform !== "string" || typeof r.format !== "string" || !Array.isArray(r.sizes)) continue;
    const key = `${networkKey(r.platform)}/${r.format}`;
    if (!asked.has(key) || out.has(key)) continue;
    const sizes: ReadSize[] = [];
    for (const s of r.sizes as Array<Record<string, unknown>>) {
      if (!s || typeof s !== "object") continue;
      const { width, height, part } = s;
      if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height)) continue;
      if (part !== "cheat_sheet" && part !== "section") continue;
      sizes.push({ width, height, part });
    }
    out.set(key, sizes);
  }
  return out;
}

/** The first JSON object in a text answer, or null: for a model that answered in words instead of calling the tool. */
export function jsonIn(text: string): unknown {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

export type Outcome = "same" | "changed" | "held" | "confirmed" | "refused" | "reverted" | "unusable" | "retried";
/** Why a row was refused: not_read (the model gave nothing for it), not_on_page (nothing it gave is written there), the check its first listed size failed (platformSize.ts, checkSize), or model_refused (the image model refused that size and has not drawn it since). */
export type Refusal = "not_read" | "not_on_page" | "not_whole" | "edge" | "shape" | "page" | "picture" | "model_refused";

/** What the image model did with sizes, as two exact questions about one size of one row. */
export interface ModelWord { refused(key: Key, size: Size): boolean; drawn(key: Key, size: Size): boolean }
export const NO_WORD: ModelWord = { refused: () => false, drawn: () => false };

/**
 * The image model's word on each size, from platform_size_outcomes. A size
 * is refused when a refusal of it counts (a design was refused in it and
 * drawn at once in another picture size; sizeFallback.ts) and the size has
 * not been drawn since. It is drawn when it has been drawn and is not
 * refused.
 */
export function modelWord(outcomes: SizeOutcomeRow[]): ModelWord {
  const find = (key: Key, size: Size) => outcomes.find((o) => o.platform === key.platform && o.format === key.format && o.width === size.width && o.height === size.height);
  const refused = (key: Key, size: Size) => {
    const o = find(key, size);
    return !!o?.refusal_confirmed_at && (!o.drawn_at || Date.parse(o.refusal_confirmed_at) > Date.parse(o.drawn_at));
  };
  return { refused, drawn: (key, size) => !!find(key, size)?.drawn_at && !refused(key, size) };
}

/**
 * A row whose size in use the image model refuses, whatever the guide
 * says: it goes back to the size before it when the model has drawn that
 * one (reverted). With no such size it is read by no request (unusable),
 * so designs are made at the usual size; a row that already is, is left to
 * the guide's read, which tries it again (decide, retried). Null for a row
 * whose size is not refused.
 */
export function refusedRow(row: SizeRow, word: ModelWord): RowResult | null {
  if (!word.refused(row, row)) return null;
  const base = { platform: row.platform, format: row.format, from: [row.width, row.height] as [number, number], read: [], listed: [], reason: "model_refused" as const };
  const before = row.previous_width && row.previous_height ? { width: row.previous_width, height: row.previous_height } : null;
  if (before && word.drawn(row, before) && checkSize(before, row.format).ok) return { ...base, outcome: "reverted", to: [before.width, before.height] };
  return row.usable === false ? null : { ...base, outcome: "unusable" };
}
export interface RowResult extends Key {
  outcome: Outcome;
  reason?: Refusal;
  /** The size in use when the run compared. */
  from: [number, number];
  /** The size it becomes (changed, confirmed) or the size held as pending. */
  to?: [number, number];
  /** What the model gave for the row, as given. */
  read: Array<[number, number, Part]>;
  /** Of those, the sizes written on the page, in reading order. */
  listed: Array<[number, number, Part]>;
}

/** The sizes in a platform's cheat sheet cell, in the order the cell writes them. A Story has none: it is never read from the cheat sheet. */
export function cheatSizes(key: Key, parts: ReturnType<typeof guideParts>): ReadSize[] {
  if (key.format === "story") return [];
  const out: ReadSize[] = [];
  for (const c of sizesIn(parts.cheat.get(key.platform) ?? "")) {
    if (!out.some((o) => sameSize(o, c))) out.push({ ...c, part: "cheat_sheet" });
  }
  return out;
}

/**
 * The sizes listed for a row, in reading order. The cheat sheet cell is one
 * table cell with one meaning, so its sizes are read by the code itself,
 * in the order the cell writes them, whatever the model said about it. The
 * section's sizes follow: which sizes of a section are the post's is the
 * model's reading, and each counts only when it is written in the
 * platform's section, in the order the model listed them. A size named
 * twice counts once.
 */
export function listedSizes(key: Key, read: ReadSize[], parts: ReturnType<typeof guideParts>): ReadSize[] {
  const inSection = sizesIn(parts.section.get(key.platform) ?? "");
  const out = cheatSizes(key, parts);
  for (const r of read) {
    if (r.part === "section" && inSection.some((s) => sameSize(s, r)) && !out.some((o) => sameSize(o, r))) out.push(r);
  }
  return out;
}

/**
 * What a row's read changes.
 *
 *   same       the size in use is written in the platform's cheat sheet cell
 *              or anywhere in its section (the code reads both itself,
 *              whatever the model returned), or is among the listed sizes:
 *              it stays.
 *   refused    the model gave nothing for the row, nothing listed is
 *              written on the page, or the first listed size fails a
 *              check: nothing changes. The job never falls through to
 *              another shape.
 *   held       the first listed size differs from the size in use and is
 *              not the pending size: it becomes the pending size, and the
 *              size in use stays.
 *   confirmed  it differs and is the pending size, so this is the second
 *              read in a row that gave it: it is the new size.
 *
 * Every change takes two reads, however near the new size is to the size
 * in use (since 18 Nov 2026; before, a size within a quarter of each edge
 * and a tenth of the shape was written on one read). One read is one model's
 * reading of one fetch of the page: a size that a section mentions for
 * something else, picked once, must not become the size of every design.
 * The job is queued once a day at most, so the read that confirms is a
 * later day's, unless a person queued a second job by hand. `changed` is no
 * longer an outcome of a read; record_platform_size_read still knows it,
 * and runs from before this rule hold it.
 *
 * A row no request reads (usable false, its size refused by the image
 * model) is not final: where the size would stay, the outcome is `retried`
 * and the row is read again, so the next design tries the size. One
 * refused design a week at most, if the model truly cannot draw it.
 *
 * A held size lasts one read: the next read of the row that gives another
 * size clears or replaces it, and after three reads that refuse the row it
 * is dropped (record_platform_size_read).
 */
export function decide(row: SizeRow, read: ReadSize[] | undefined, parts: ReturnType<typeof guideParts>, word: ModelWord = NO_WORD): RowResult {
  const base = { platform: row.platform, format: row.format, from: [row.width, row.height] as [number, number] };
  const given = (read ?? []).map((s) => [s.width, s.height, s.part] as [number, number, Part]);
  // The cheat sheet cell still names the size in use: it stays, whatever the reading model answered.
  const cell = cheatSizes(row, parts);
  const tuple = (s: ReadSize) => [s.width, s.height, s.part] as [number, number, Part];
  const stays = row.usable === false ? "retried" as const : "same" as const;
  // So does the platform's own section: while the page still writes the size in use there, it stays.
  const written = cell.some((s) => sameSize(s, row)) || sizesIn(parts.section.get(row.platform) ?? "").some((s) => sameSize(s, row));
  if (written) return { ...base, outcome: stays, read: given, listed: listedSizes(row, read ?? [], parts).map(tuple) };
  if (!read || !read.length) return { ...base, outcome: "refused", reason: "not_read", read: given, listed: cell.map(tuple) };
  const listed = listedSizes(row, read, parts);
  const shown = listed.map(tuple);
  if (!listed.length) return { ...base, outcome: "refused", reason: "not_on_page", read: given, listed: shown };
  if (listed.some((s) => sameSize(s, row))) return { ...base, outcome: stays, read: given, listed: shown };
  const first = listed[0];
  const check = checkSize(first, row.format);
  if (!check.ok) return { ...base, outcome: "refused", reason: check.reason, to: [first.width, first.height], read: given, listed: shown };
  // A size the image model refused, and has not drawn since, is not drawable. (The row's own size is tried again above.)
  if (word.refused(row, first)) return { ...base, outcome: "refused", reason: "model_refused", to: [first.width, first.height], read: given, listed: shown };
  const to: [number, number] = [first.width, first.height];
  // Every change waits: the size is written only when the read before this one gave it too.
  const pending = row.pending_width === first.width && row.pending_height === first.height;
  return { ...base, outcome: pending ? "confirmed" : "held", to, read: given, listed: shown };
}
