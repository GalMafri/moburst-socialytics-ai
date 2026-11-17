// supabase/functions/_shared/design/platformSize.ts
//
// A design in the shape its platform is uploaded in (17 Nov 2026, spec
// docs/superpowers/specs/2026-11-17-platform-sizes-design.md). The sizes
// live in the platform_sizes table, one row per platform and format, and a
// weekly job keeps them current (platformSizeRefresh.ts). A row gives the
// design its shape and the size its delivery never goes below; the
// delivered picture keeps the quality width every design had before the
// table (canva/finish.ts, deliveredSize). This file holds what decides, in
// plain arithmetic:
//
//   the key        which row a request reads, from its platform and format;
//   the checks     whether a size is one the app can make: sane edges, a
//                  shape it draws, a page for it, a picture the image model
//                  draws and that is never enlarged on delivery;
//   the page       the rectangle a size is planned and drawn on, in the
//                  size's own shape and near today's pixel count;
//   the delivery   the size the finished picture has (checkSize gives the
//                  page, the picture the model draws and this, together);
//   the placement  where the client's logo goes on a page that is not 4:5;
//   wildly         how far a newly read size may be from the size in use
//                  before it has to be read twice.
//
// A request with no row, or a row that fails a check, is designed exactly
// as before this file existed. Free of Deno and network imports.

import { MODEL_MAX_EDGE, deliveredSize, pictureSize, type Placement } from "../canva/finish.ts";
import { formatKind } from "../calendar/reasonText.ts";
import { FRAME } from "../lifecycle/designSettings.ts";
import { networkKey } from "../sprout/publishRules.ts";
import { STORY_PAGE, isStoryPost } from "./story.ts";
import { sameShape, shapeLabel, shapeWord, type Size } from "./shape.ts";

export { sameShape, shapeLabel, shapeWord, type Size };

export type UploadFormat = "image" | "carousel" | "story";
export const UPLOAD_FORMATS: readonly UploadFormat[] = ["image", "carousel", "story"];

/** A row of platform_sizes as a request keeps it (design_requests.upload_size). */
export interface UploadSize extends Size { platform: string; format: UploadFormat }

/** The shortest and longest edge an upload size may have. The same numbers are in the table's checks (the migration test compares them). */
export const MIN_EDGE = 600;
export const MAX_EDGE = 2560;
/** Width over height of a still the app draws: from 1:2 to 2:1. A Story is exactly 9:16. */
export const STILL_SHAPE: readonly [number, number] = [0.5, 2];
/** A page's pixel count stays within this share of today's page for its format. */
export const PAGE_COUNT_BAND = 0.25;
/** A page's shape is within this share of the upload size's, so delivery moves no edge by more than 0.2%. */
export const SHAPE_TOLERANCE = 0.002;
/** The most pixels the image model is asked for: the Story's picture, the largest the app draws. */
export const MAX_PICTURE_PIXELS = 2160 * 3840;
/** A newly read size is far from the size in use when its shape differs by more than this share. */
export const WILD_SHAPE = 0.1;
/** Or when either edge differs by more than this share. */
export const WILD_EDGE = 0.25;

/** The page a still was always planned on: the 4:5 frame the stored placement is defined on. */
export const STILL_PAGE: Size = { width: FRAME.w, height: FRAME.h };

const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
export const sameSize = (a: Size, b: Size): boolean => a.width === b.width && a.height === b.height;

/**
 * The row a post reads. The platform is the publish path's own key
 * (networkKey). The format: a Story post reads `story`; a carousel reads
 * `carousel`; a document and any video read nothing (the guide gives no
 * size for a document, and a video is not a still); everything else is an
 * image. Null when the platform has no name.
 */
export function uploadSizeKey(post: { platform?: string | null; format?: string | null }): { platform: string; format: UploadFormat } | null {
  const platform = networkKey(post.platform);
  if (!/^[a-z]+$/.test(platform)) return null;
  if (isStoryPost(post)) return { platform, format: "story" };
  const kind = formatKind(post.format, post.platform);
  if (kind === "document" || kind === "video" || kind === "short video") return null;
  return { platform, format: kind === "carousel" ? "carousel" : "image" };
}

/**
 * The rows to look for, in order: the key's own row, then for a carousel
 * the platform's image row (a carousel is uploaded as feed images).
 */
export function uploadSizeKeys(post: { platform?: string | null; format?: string | null }): Array<{ platform: string; format: UploadFormat }> {
  const key = uploadSizeKey(post);
  if (!key) return [];
  return key.format === "carousel" ? [key, { platform: key.platform, format: "image" }] : [key];
}

/**
 * The page an upload size is planned and drawn on: of every rectangle in
 * multiples of 16 whose pixel count is within PAGE_COUNT_BAND of today's
 * page for the format (1088x1360 for a still, 1152x2048 for a Story), the
 * one whose shape is closest to the size's; of equally close ones, the one
 * closest in pixel count. 1080x1350 gives 1088x1360, 1200x1200 gives
 * 1216x1216, 1600x900 gives 1536x864 and 1080x1920 as a Story 1152x2048.
 */
export function pageFor(size: Size, format: UploadFormat): Size | null {
  if (!(size.width > 0) || !(size.height > 0)) return null;
  const base = format === "story" ? STORY_PAGE : STILL_PAGE;
  const count = base.width * base.height;
  const least = count * (1 - PAGE_COUNT_BAND), most = count * (1 + PAGE_COUNT_BAND);
  let best: { width: number; height: number; off: number; far: number } | null = null;
  for (let w = 256; w <= MODEL_MAX_EDGE; w += 16) {
    const from = Math.max(256, Math.ceil(least / w / 16) * 16), to = Math.min(MODEL_MAX_EDGE, Math.floor(most / w / 16) * 16);
    for (let h = from; h <= to; h += 16) {
      const exact = w * size.height === h * size.width;
      const off = exact ? 0 : Math.abs(Math.log((w / h) / (size.width / size.height)));
      const far = Math.abs(w * h - count);
      if (!best || off < best.off - 1e-12 || (Math.abs(off - best.off) <= 1e-12 && far < best.far)) best = { width: w, height: h, off, far };
    }
  }
  return best ? { width: best.width, height: best.height } : null;
}

export type SizeCheck = { ok: true; page: Size; picture: Size; delivered: Size } | { ok: false; reason: "not_whole" | "edge" | "shape" | "page" | "picture" };

/**
 * What a row's size becomes: the page it is planned on, the picture the
 * image model draws and the size it is delivered at (deliveredSize: the
 * row's shape at the quality width, or at the row's own width when that is
 * larger). And whether it is one the app can make for a format, on exact facts:
 *   not_whole  an edge is not a whole number;
 *   edge       an edge is under MIN_EDGE or over MAX_EDGE;
 *   shape      a still outside STILL_SHAPE, or a Story that is not 9:16;
 *   page       no page within SHAPE_TOLERANCE of the size's shape;
 *   picture    the picture the image model would draw (pictureSize) is not
 *              in multiples of 16, has an edge over the model's longest,
 *              more pixels than the largest picture the app draws, another
 *              shape than its page, or is smaller than the delivered size
 *              on an edge (delivery would enlarge it).
 */
export function checkSize(size: { width: unknown; height: unknown }, format: UploadFormat): SizeCheck {
  const { width, height } = size;
  if (!whole(width) || !whole(height)) return { ok: false, reason: "not_whole" };
  if (width < MIN_EDGE || width > MAX_EDGE || height < MIN_EDGE || height > MAX_EDGE) return { ok: false, reason: "edge" };
  const s = { width, height };
  if (format === "story") {
    if (!sameShape(s, STORY_PAGE)) return { ok: false, reason: "shape" };
  } else if (width < STILL_SHAPE[0] * height || width > STILL_SHAPE[1] * height) return { ok: false, reason: "shape" };
  const page = pageFor(s, format);
  if (!page || Math.abs((page.width / page.height) / (width / height) - 1) > SHAPE_TOLERANCE) return { ok: false, reason: "page" };
  const [pw, ph] = pictureSize([page.width, page.height]);
  const [dw, dh] = deliveredSize([page.width, page.height], s);
  const drawable = pw % 16 === 0 && ph % 16 === 0 && pw >= 16 && ph >= 16
    && pw <= MODEL_MAX_EDGE && ph <= MODEL_MAX_EDGE && pw * ph <= MAX_PICTURE_PIXELS
    && Math.abs((pw / ph) / (page.width / page.height) - 1) <= SHAPE_TOLERANCE
    && dw <= pw && dh <= ph;
  if (!drawable) return { ok: false, reason: "picture" };
  return { ok: true, page, picture: { width: pw, height: ph }, delivered: { width: dw, height: dh } };
}

/**
 * What a job is given from its request's row: the page it is planned and
 * drawn on, and the row itself (`deliver`), which the worker turns into the
 * delivered size (deliveredSize) and records the image model's answer
 * against. Null (the job is made as before) when the request has none, when
 * what it holds is not a size that passes checkSize, or when it is a
 * Story's size on a post that is not a Story or the other way round.
 */
export function jobShape(uploadSize: unknown, story: boolean): { page: Size; deliver: Size & { platform?: string; format: UploadFormat } } | null {
  const u = uploadSize as Partial<UploadSize> | null | undefined;
  if (!u || typeof u !== "object" || !UPLOAD_FORMATS.includes(u.format as UploadFormat)) return null;
  if ((u.format === "story") !== story) return null;
  const check = checkSize({ width: u.width, height: u.height }, u.format as UploadFormat);
  if (!check.ok) return null;
  // The row's key goes with the size, so what the image model does with it can be recorded against the row (sizeFallback.ts).
  return { page: check.page, deliver: { width: u.width as number, height: u.height as number, ...(typeof u.platform === "string" ? { platform: u.platform } : {}), format: u.format as UploadFormat } };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The client's logo spot on a page that is not 4:5. The stored placement is
 * in shares of the 4:5 frame (FRAME). On a 4:5 page it is returned as it
 * is. On any other page the logo keeps its pixel size and its distance from
 * its corner, both scaled by the square root of the two pages' areas (the
 * pages have nearly the same pixel count, so the logo covers the same share
 * of the picture):
 *
 *   width  the logo's pixels on the frame, scaled, as a share of the page;
 *   left   the same for the distance to the side it is anchored to;
 *   top    the gap to the nearer of the top and bottom edges is kept,
 *          scaled, and never past the point where the logo is centered.
 *
 * The logo always ends inside the page: a logo too wide for it is narrowed.
 */
export function pagePlacement(placement: Placement, logoW: number, logoH: number, page: Size): Placement {
  const frame = STILL_PAGE;
  if (sameShape(page, frame)) return placement;
  const k = Math.sqrt((page.width * page.height) / (frame.width * frame.height));
  const tall = logoH / Math.max(1, logoW);
  const side = placement.anchor === "center" ? 0 : Math.max(0, (placement.left ?? 0) * frame.width * k);
  // Narrowed when the page cannot hold it, across or down.
  const widthPx = Math.min(placement.width * frame.width * k, page.width - side, tall > 0 ? page.height / tall : Infinity);
  const heightPx = widthPx * tall;
  const frameLogoH = placement.width * frame.width * tall;
  const above = Math.max(0, placement.top * frame.height);
  const below = Math.max(0, frame.height - above - frameLogoH);
  const middle = Math.max(0, (page.height - heightPx) / 2);
  const topPx = above <= below ? Math.min(above * k, middle) : page.height - heightPx - Math.min(below * k, middle);
  const width = round4(widthPx / page.width);
  const top = round4(Math.max(0, topPx) / page.height);
  if (placement.anchor === "center") return { anchor: "center", width, top };
  return { anchor: placement.anchor, width, top, left: round4(side / page.width) };
}

/**
 * The shape the planner is told about: null for a Story (its own line says
 * what it is), for a request with no size and for a 4:5 page, which is the
 * shape the planner has always planned for. Otherwise "square frame (1:1)",
 * "wide frame (16:9)".
 */
export function plannerShape(uploadSize: unknown, story: boolean): string | null {
  const shape = story ? null : jobShape(uploadSize, false);
  if (!shape || sameShape(shape.page, STILL_PAGE)) return null;
  return `${shapeWord(shape.page)} frame (${shapeLabel(shape.page)})`;
}

/**
 * Whether a newly read size is far from the size in use: its shape differs
 * by more than WILD_SHAPE, or either edge by more than WILD_EDGE. Such a
 * size is accepted only when the next read of the row gives it again.
 */
export function isWild(from: Size, to: Size): boolean {
  const shape = Math.abs((to.width / to.height) / (from.width / from.height) - 1);
  const edge = Math.max(Math.abs(to.width / from.width - 1), Math.abs(to.height / from.height - 1));
  return shape > WILD_SHAPE || edge > WILD_EDGE;
}
