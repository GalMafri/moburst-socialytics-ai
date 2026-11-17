// supabase/functions/_shared/design/logoPick.ts
//
// The logo the client's posts show (17 Nov 2026; spec:
// docs/superpowers/specs/2026-11-16-logo-tone-design.md, section 12). A
// website can serve several marks of one brand (a round icon in its
// schema.org record, a wordmark in its header), and the website read keeps
// the first it meets. The client's logo is the mark its own posts carry:
// every mark the brand's own homepage serves for itself is looked for on the
// client's posts with the test a design gets (logoFound, logoMatch.ts).
//
// The logo the client has counts every post it is found on, whatever any
// candidate scores there. Found on two posts or more, the posts carry it and
// it is never replaced. A candidate counts a post only where it is found,
// scores higher there than the client's logo (found or not) and is the
// candidate with the highest score there. A logo the posts do not carry is
// replaced by the candidate they carry on the most posts. Its place and
// width then come from the rectangles where it was found.
//
// This file holds what decides: the count, the choice, and the placement
// from the found rectangles. Nothing here passes or fails a design. Free of
// Deno and network imports.

import type { Placement, Rect } from "../picture/contract.ts";
import { FRAME } from "../lifecycle/designSettings.ts";

/** The version of this rule. It is part of the design_settings step's key, so every lifecycle client is looked at once when the rule arrives. */
export const LOGO_PICK_RULE = 1;

/** The posts carry a mark when at least this many of them count for it: for the logo the client has, the posts it is found on. One post alone is not what the client's posts carry. */
export const PICK_MIN_POSTS = 2;

/** What one post gave for one mark: whether the test a design gets found it there, and the score of the best match. */
export interface OnPost { found: boolean; score: number }

/**
 * Which mark each post matches best, and how many posts count for each mark.
 * `marks[0]` is what each post gave for the logo the client has, the rest
 * the candidates in page order, every list in the order of the posts (null
 * for a post that was not read).
 *
 * `by` holds, for each post, the one mark it matches best, as the mark's
 * place in `marks`: the mark with the highest score there, the client's logo
 * when equal, then the earlier candidate; and only when that mark is found
 * there (the test a design gets), else null. A mark that scores highest at a
 * size the test does not accept is still what the post carries, so no other
 * mark has that post.
 *
 * `counts[0]`, for the logo the client has, is every post it is found on,
 * whatever a candidate scores there. Two files of one logo score within a
 * hair of each other on the same post, and which is ahead depends on how
 * each file was drawn, so a score never takes a post from the logo the
 * client has.
 *
 * `counts[k]`, for a candidate, is the posts it matches best: where it is
 * found, scores higher than the client's logo (found or not) and no other
 * candidate scores higher. So a mark that matches a part of the mark a post
 * really carries (a sister lockup, found at a lower score in the same place)
 * gets nothing for that post.
 */
export function postsCarrying(marks: Array<Array<OnPost | null | undefined>>): { by: Array<number | null>; counts: number[] } {
  const posts = Math.max(0, ...marks.map((m) => m.length));
  const by: Array<number | null> = [];
  const counts = marks.map(() => 0);
  for (let p = 0; p < posts; p++) {
    // The mark with the highest score on this post, found or not.
    let best: number | null = null;
    for (let m = 0; m < marks.length; m++) {
      const got = marks[m][p];
      if (got && (best === null || got.score > marks[best][p]!.score)) best = m;
    }
    const mark = best !== null && marks[best][p]!.found === true ? best : null;
    by.push(mark);
    if (marks[0]?.[p]?.found === true) counts[0]++;
    if (mark !== null && mark > 0) counts[mark]++;
  }
  return { by, counts };
}

/**
 * What one post gave for a logo that was read twice: found when either read
 * found it, with the higher score of the two. Null when neither read the
 * post. A logo that a choice made the client's (a standing choice) is read
 * by its own search where the model's read says the posts carry the logo,
 * the search every candidate gets, and by its set at the place measured
 * from its posts, where a design is searched. Both are the test a design
 * gets, so the logo counts a post either one finds it on, and a candidate
 * has to beat the higher of its two scores there.
 */
export function eitherRead(a: OnPost | null | undefined, b: OnPost | null | undefined): OnPost | null {
  if (!a || !b) return a ?? b ?? null;
  return { found: a.found === true || b.found === true, score: Math.max(a.score, b.score) };
}

/**
 * Which candidate replaces the client's logo, or null when the client keeps
 * the logo it has. `current` is the number of posts the logo the client has
 * is found on, and `candidates` are in page order, each with the number of
 * posts that count for it (postsCarrying). A logo the posts carry, found on
 * two or more, is never replaced, however many posts a candidate has and
 * whatever it scores: the rule corrects a logo the posts do not show, and
 * never trades one mark a brand uses for another. Otherwise the candidate on
 * the most posts is taken when the posts carry it, the earlier one when
 * equal.
 */
export function chooseLogo(current: number, candidates: Array<{ id: string; found: number }>): string | null {
  if (current >= PICK_MIN_POSTS) return null;
  let best: { id: string; found: number } | null = null;
  for (const c of candidates) if (!best || c.found > best.found) best = c;
  return best && best.found >= PICK_MIN_POSTS ? best.id : null;
}

/**
 * The width and height of a picture, from its file header: PNG, JPEG, GIF
 * and WebP. Null for bytes that are none of these. Nothing is decoded.
 */
export function imageSize(bytes: Uint8Array): [number, number] | null {
  const n = bytes.length;
  if (n < 12) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0) === 0x89504e47) return n >= 24 ? [v.getUint32(16), v.getUint32(20)] : null;
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return [v.getUint16(6, true), v.getUint16(8, true)];
  if (v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250 && n >= 30) {
    const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (kind === "VP8 ") return [v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff];
    if (kind === "VP8L") {
      const b = v.getUint32(21, true);
      return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
    }
    if (kind === "VP8X") return [1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))];
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // A JPEG is a run of segments; the frame header (SOF0 to SOF15, without the three markers that are tables) holds the size.
    let at = 2;
    while (at + 9 < n) {
      if (bytes[at] !== 0xff) { at++; continue; }
      const marker = bytes[at + 1];
      if (marker === 0xff) { at++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [v.getUint16(at + 7), v.getUint16(at + 5)];
      at += 2 + v.getUint16(at + 2);
    }
  }
  return null;
}

/** A found logo on one post: its rectangle in the post's pixels, and the post's own width and height. */
export interface FoundAt { rect: Rect; frame: [number, number] }

/** How far the middle of a logo may lie from the middle of its post and still be a centered logo, as a share of the post's width. */
export const CENTER_REACH = 0.1;

/**
 * The run of sizes a client's own posts show a logo at, as shares of its
 * usual width: the run the sizes a design is searched at were made for
 * (logoMatch.ts, LOGO_SCALES: "from about 0.55 of it to about 1.2 of it").
 * A usual width that keeps every found size inside this run keeps every one
 * of them well inside the sizes searched (above 0.48 and below 1.32).
 */
export const POSTS_RUN: [number, number] = [0.55, 1.2];

function middle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Where a logo sits and how wide it is, from the rectangles where it was
 * found on the client's posts, each taken as shares of its own post. Every
 * value is the middle one over the posts (the lower of the two middle ones
 * for an even count), so it is a value a real post has.
 *
 * The anchor is center when the logo's middle lies within CENTER_REACH of
 * the post's middle; otherwise left or right, with `left` the distance to
 * that edge. `top` is the top edge. `width` is the middle width, moved only
 * as far as needed so that the sizes the logo was found at run from 0.55 to
 * 1.2 of it (POSTS_RUN): a logo the posts show small on some and large on
 * others gets the usual width from which both are sizes the client uses.
 * When the found sizes run wider than that, it is the width that leaves the
 * same room at both ends. The top is held so the logo ends inside its post
 * and inside the 4:5 page a design is drawn on. Null with no rectangle to
 * measure.
 *
 * This sets where a canvas starts. It passes or fails nothing.
 */
export function measuredPlacement(found: FoundAt[]): Placement | null {
  const usable = found.filter((f) => f.frame[0] > 0 && f.frame[1] > 0 && f.rect.width > 0 && f.rect.height > 0);
  if (!usable.length) return null;
  const widths = usable.map((f) => f.rect.width / f.frame[0]);
  const centers = usable.map((f) => (f.rect.x + f.rect.width / 2) / f.frame[0]);
  const least = Math.ceil((Math.max(...widths) / POSTS_RUN[1]) * 1000) / 1000;
  const most = Math.floor((Math.min(...widths) / POSTS_RUN[0]) * 1000) / 1000;
  let width = least <= most ? Math.min(Math.max(round3(middle(widths)), least), most) : (Math.max(...widths) / POSTS_RUN[1] + Math.min(...widths) / POSTS_RUN[0]) / 2;
  width = round3(Math.max(0.05, Math.min(0.8, width)));
  // The logo's height at this width, as a share of the height of its post or of the page a design is drawn on (4:5),
  // whichever makes it taller: the top never pushes it off either. Posts taller than the page would otherwise let it end below the page.
  const page = FRAME.w / FRAME.h;
  const tall = middle(usable.map((f) => (f.rect.height / f.rect.width) * Math.max(f.frame[0] / f.frame[1], page)));
  const top = round3(Math.max(0, Math.min(middle(usable.map((f) => f.rect.y / f.frame[1])), 1 - width * tall)));
  if (middle(centers.map((c) => Math.abs(c - 0.5))) <= CENTER_REACH) return { anchor: "center", width, top };
  if (middle(centers) < 0.5) return { anchor: "left", width, top, left: round3(Math.max(0, middle(usable.map((f) => f.rect.x / f.frame[0])))) };
  return { anchor: "right", width, top, left: round3(Math.max(0, middle(usable.map((f) => (f.frame[0] - f.rect.x - f.rect.width) / f.frame[0])))) };
}
