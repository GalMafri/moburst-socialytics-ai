// supabase/functions/_shared/video/videoSizeRead.ts
//
// Reading Sprout Social's video specs guide, and deciding what a read
// changes for the video rows of platform_sizes (18 Nov 2026). The daily
// platform_sizes job (design/platformSizeRefresh.ts) fetches the page and
// hands the text here; the image rows are read from the image sizes guide
// as before (design/platformSizeRead.ts). Everything is decided in code, on
// exact facts, and no model is asked: the video guide gives each platform's
// size in one table cell.
//
//   the table    the rows under the header with a "Recommended resolution"
//                column ("What's the best video size for each social media
//                platform?"), each a platform and format with its size;
//   the cell     a row's cell: the platform's table row that is not an ad or
//                a Story, a Reels or Shorts row for a short video and any
//                other for a video, else the platform's one row;
//   the outcome  what the read changes, under the image rows' rule: a size
//                in use stays while the row's cell still gives it (written
//                there, or inside a range the cell gives, "256×144 to
//                4096×2304"); a new size is held on one read and written
//                only when a read on a later day gives it again. No size is
//                ever written on one read. A platform's section is not read:
//                one section covers a platform's videos and Shorts alike.
//
// Free of Deno and network imports.

import { networkKey } from "../sprout/publishRules.ts";
import { guideParts, heldEarlier, israelDay, sizesIn, type Part, type RowResult, type SizeRow } from "../design/platformSizeRead.ts";

export { israelDay };
import { type Size } from "../design/shape.ts";
import { sameSize } from "../design/platformSize.ts";
import { checkVideoSize, type VideoFormat } from "./videoSize.ts";

/** The guide. Sprout is where this team publishes, so its guide is the source. */
export const VIDEO_GUIDE_URL = "https://sproutsocial.com/insights/social-media-video-specs-guide/";

/** A row of the guide's size table: its first cell and its "Recommended resolution" cell. */
export interface TableRow { label: string; cell: string }

/**
 * The guide's size table: the table rows after the header row that has a
 * "Recommended resolution" column, up to the next heading. Empty when the
 * page has no such table.
 */
export function videoTable(text: string): TableRow[] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.includes(" | ") && l.split(" | ").some((c) => /recommended resolution/i.test(c)));
  if (at < 0) return [];
  const col = lines[at].split(" | ").findIndex((c) => /recommended resolution/i.test(c));
  if (col < 1) return [];
  const out: TableRow[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,6} /.test(line)) break;
    if (!line.includes(" | ")) continue;
    const cells = line.split(" | ").map((c) => c.trim());
    if (cells.length > col) out.push({ label: cells[0], cell: cells[col] });
  }
  return out;
}

const SHORT = /\b(reels?|shorts?)\b/i;
const NOT_ORGANIC = /\bads?\b|\bstor(y|ies)\b/i;

/**
 * The table cell a video row reads, or null when the table has none for it.
 * The platform's rows, leaving out ads and Stories; of those, for a short
 * video the ones that name Reels or Shorts and for a video the ones that do
 * not, else all of them (one row such as "TikTok" or "Facebook video and
 * Reels" is both); the first in the table.
 */
export function videoCell(key: { platform: string; format: VideoFormat }, table: TableRow[]): string | null {
  const own = table.filter((r) => networkKey(r.label) === key.platform && !NOT_ORGANIC.test(r.label));
  const fit = own.filter((r) => SHORT.test(r.label) === (key.format === "short_video"));
  return (fit[0] ?? own[0])?.cell ?? null;
}

/** The sizes a video row's cell writes, in the order written, each once. */
export function cellSizes(cell: string | null): Size[] {
  const out: Size[] = [];
  for (const s of sizesIn(cell ?? "")) if (!out.some((o) => sameSize(o, s))) out.push(s);
  return out;
}

/** Whether a cell gives a range ("256×144 to 4096×2304") and the size lies within it, edge by edge. */
export function inCellRange(cell: string | null, size: Size): boolean {
  const sizes = sizesIn(cell ?? "");
  if (sizes.length !== 2 || !/\bto\b/i.test(cell ?? "")) return false;
  const [a, b] = sizes;
  return size.width >= Math.min(a.width, b.width) && size.width <= Math.max(a.width, b.width)
    && size.height >= Math.min(a.height, b.height) && size.height <= Math.max(a.height, b.height);
}


/** What a video row's read comes to: an image row's result (platformSizeRead.ts) with a video format. */
export type VideoRowResult = Omit<RowResult, "format"> & { format: VideoFormat };

/** A video row as the job reads it: an image row's columns (when its size was held among them). */
export interface VideoSizeRow extends Omit<SizeRow, "format"> { format: VideoFormat }

/**
 * What a video row's read changes.
 *
 *   same       the size in use is written in the row's cell, or lies in
 *              a range the cell gives: it stays.
 *   refused    the table gives the row no size, or the first size its cell
 *              writes fails the check (videoSize.ts, checkVideoSize):
 *              nothing changes, and the job never falls through to another
 *              size.
 *   held       the first size the cell writes differs from the size in use
 *              and is not the size held on an earlier day: it is held.
 *   confirmed  it is the size held on an earlier day (Israel time): it is
 *              the new size. A second read on the same day (a retry of the
 *              job) holds it again instead, so a size is never written on
 *              one day's reading of the page.
 */
export function decideVideo(row: VideoSizeRow, table: TableRow[], now: Date): VideoRowResult {
  const base = { platform: row.platform, format: row.format, from: [row.width, row.height] as [number, number] };
  const cell = videoCell(row, table);
  const listed = cellSizes(cell);
  const shown = listed.map((s) => [s.width, s.height, "cheat_sheet" as Part] as [number, number, Part]);
  const written = listed.some((s) => sameSize(s, row)) || inCellRange(cell, row);
  if (written) return { ...base, outcome: "same", read: shown, listed: shown };
  if (!listed.length) return { ...base, outcome: "refused", reason: cell === null ? "not_read" : "not_on_page", read: shown, listed: shown };
  const first = listed[0];
  const check = checkVideoSize(first);
  const to: [number, number] = [first.width, first.height];
  if (!check.ok) return { ...base, outcome: "refused", reason: check.reason, to, read: shown, listed: shown };
  const pending = row.pending_width === first.width && row.pending_height === first.height;
  // A held video size always has its time (it was held by this job); none recorded is not taken as earlier.
  const earlier = !!row.pending_at && heldEarlier(row, now);
  return { ...base, outcome: pending && earlier ? "confirmed" : "held", to, read: shown, listed: shown };
}

/**
 * The parts of the video guide a read uses, and whether the page is the
 * guide: a size table with a row for at least one of the rows asked about.
 */
export function videoGuideParts(text: string, rows: Array<{ platform: string }>): { table: TableRow[]; sections: Map<string, string>; known: boolean } {
  const table = videoTable(text);
  const sections = guideParts(text).section;
  const known = rows.some((r) => table.some((t) => networkKey(t.label) === r.platform));
  return { table, sections, known };
}
