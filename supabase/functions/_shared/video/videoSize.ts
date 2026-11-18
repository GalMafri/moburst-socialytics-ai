// supabase/functions/_shared/video/videoSize.ts
//
// A video in the size its platform is uploaded in (18 Nov 2026: "of course
// youtube long videos should include landscape"). Until now every video was
// 9:16. The sizes live in platform_sizes, as the stills' do, with the formats
// `video` and `short_video` (the calendar's own kinds, formatKind: a Reel, a
// Short or a vertical video is a short video; any other video post is a
// video). A daily job keeps them current from Sprout Social's video specs
// guide (videoSizeRead.ts). This file holds what decides, in plain arithmetic:
//
//   the key      which row a video post reads, from its platform and format;
//   the check    whether a stored size is one the video path can make;
//   the frame    what a size becomes: the clip's aspect (the nearest one the
//                video model makes), the size the MP4 is encoded at, the
//                picture the opening frame and the title are drawn at, and
//                the shape's words for the prompts that name it.
//
// A post with no row, a row that fails the check, or a job from before this
// file is made exactly as every video was: VERTICAL, the sizes below, which
// are the constants the video path always had. Free of Deno and network
// imports.

import { formatKind } from "../calendar/reasonText.ts";
import { videoAspect } from "../higgsfield/generate.ts";
import { networkKey } from "../sprout/publishRules.ts";
import { sameShape, shapeLabel, type Size } from "../design/shape.ts";

export type VideoFormat = "video" | "short_video";
export const VIDEO_FORMATS: readonly VideoFormat[] = ["video", "short_video"];

/** A video's row of platform_sizes as a request keeps it (design_requests.upload_size). */
export interface VideoUploadSize extends Size { platform: string; format: VideoFormat }

/** The edges a stored size may have: the same bounds as the table's check (platformSize.ts MIN_EDGE, MAX_EDGE). */
export const VIDEO_MIN_EDGE = 600;
export const VIDEO_MAX_EDGE = 2560;
/** Width over height of a video the app makes: from 1:2 to 2:1 (the video model's aspects reach both within an eighth). */
export const VIDEO_SHAPE: readonly [number, number] = [0.5, 2];
/** The clip's resolution: a stored size with a shorter edge is encoded larger, in its own shape, so no video is made below the clip's quality. */
export const CLIP_SHORT_EDGE = 1080;

/**
 * Everything a video's size decides. `size` is the MP4's size, `card` the
 * picture the opening frame and the title layer are drawn at (multiples of
 * 16, the encode's shape, near today's pixel count), `aspect` the clip's
 * aspect as the video model is asked for it, `label` and `word` the shape as
 * the prompts name it ("9:16", "vertical").
 */
export interface VideoFrame {
  size: Size;
  card: Size;
  aspect: string;
  label: string;
  word: "vertical" | "landscape" | "square";
  /** The row it was read from, when it was. */
  platform?: string;
  format?: VideoFormat;
}

/** Every video until 18 Nov 2026, and every video with no stored size: the sizes the video path always had (compose.ts VIDEO_SIZE, CARD_SIZE; clip.ts CLIP.aspect). */
export const VERTICAL: VideoFrame = Object.freeze({
  size: Object.freeze({ width: 1080, height: 1920 }),
  card: Object.freeze({ width: 1088, height: 1936 }),
  aspect: "9:16",
  label: "9:16",
  word: "vertical",
}) as VideoFrame;

/** A format that says the video is vertical, in any wording: 9:16, vertical, portrait. */
const SAYS_VERTICAL = /9\s*[:x×/]\s*16|\bvertical\b|\bportrait\b/i;
/** A YouTube format that names a long or standard video ("long_video", "Video", "Standard video", "Landscape video"). */
const NAMES_LONG = /^\s*(long|standard|regular|landscape|horizontal)?[\s_/-]*(form[\s_/-]*)?videos?\s*$|\blong[\s_/-]*(form|video)|\bstandard[\s_/-]*video|\b(landscape|horizontal)\b|16\s*[:x×/]\s*9/i;

/**
 * The row a video post reads, or null when it reads none. The platform is
 * the publish path's own key (networkKey). The format is `short_video` for a
 * Reel, a Short or a format that says it is vertical (9:16, vertical,
 * portrait), and `video` for any other post made as a video (a TikTok post,
 * a video post). On YouTube only a format that names a long or standard
 * video reads `video`; any other YouTube format, an empty one included, is
 * a Short's. Call it only for a post made as a video (weekRules.ts
 * designKind). formatKind is read as it is: nothing else changes for it.
 */
export function videoSizeKey(post: { platform?: string | null; format?: string | null }): { platform: string; format: VideoFormat } | null {
  const platform = networkKey(post.platform);
  if (!/^[a-z]+$/.test(platform)) return null;
  // The platform's own name in the format ("YouTube video") says nothing about its shape.
  const format = String(post.format ?? "").replace(/you\s*tube/gi, " ").trim();
  if (formatKind(post.format, post.platform) === "short video" || SAYS_VERTICAL.test(format)) return { platform, format: "short_video" };
  if (platform === "youtube" && !NAMES_LONG.test(format)) return { platform, format: "short_video" };
  return { platform, format: "video" };
}

const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
const sixteen = (n: number) => Math.max(16, 16 * Math.round(n / 16));

export type VideoSizeCheck = { ok: true; frame: VideoFrame } | { ok: false; reason: "not_whole" | "edge" | "shape" };

/**
 * Whether a stored size is one the video path makes, on exact facts, and
 * what it becomes:
 *   not_whole  an edge is not a whole number;
 *   edge       an edge is under VIDEO_MIN_EDGE or over VIDEO_MAX_EDGE;
 *   shape      wider than 2:1 or taller than 1:2.
 * The MP4 is the stored size, or the stored shape with its shorter edge at
 * CLIP_SHORT_EDGE when the stored one is shorter (720x1280 is made at
 * 1080x1920), in even pixels. The clip is asked for in the video model's
 * aspect nearest the stored shape and filled into the MP4's frame. A size
 * of exactly 9:16, at any size, is VERTICAL itself, so a vertical video is
 * made as it always was.
 */
export function checkVideoSize(size: { width: unknown; height: unknown }): VideoSizeCheck {
  const { width, height } = size;
  if (!whole(width) || !whole(height)) return { ok: false, reason: "not_whole" };
  if (width < VIDEO_MIN_EDGE || width > VIDEO_MAX_EDGE || height < VIDEO_MIN_EDGE || height > VIDEO_MAX_EDGE) return { ok: false, reason: "edge" };
  if (width < VIDEO_SHAPE[0] * height || width > VIDEO_SHAPE[1] * height) return { ok: false, reason: "shape" };
  const up = Math.max(1, CLIP_SHORT_EDGE / Math.min(width, height));
  const encode = { width: even(width * up), height: even(height * up) };
  // Any 9:16 size is the vertical frame every video had: made at 1080x1920 as always.
  if (sameShape({ width, height }, VERTICAL.size)) return { ok: true, frame: VERTICAL };
  // The pictures drawn for the video (its opening frame and title layer) keep today's pixel count, in the encode's shape.
  const k = Math.sqrt((VERTICAL.card.width * VERTICAL.card.height) / (encode.width * encode.height));
  const card = { width: sixteen(encode.width * k), height: sixteen(encode.height * k) };
  const label = shapeLabel({ width, height });
  return {
    ok: true,
    frame: {
      size: encode,
      card,
      aspect: videoAspect(label),
      label,
      word: width === height ? "square" : width > height ? "landscape" : "vertical",
    },
  };
}

/** The frame a stored row gives, with the row's key; VERTICAL when there is none or it fails the check. */
export function videoFrameOf(uploadSize: unknown): VideoFrame {
  const u = uploadSize as Partial<VideoUploadSize> | null | undefined;
  if (!u || typeof u !== "object" || !VIDEO_FORMATS.includes(u.format as VideoFormat)) return VERTICAL;
  const check = checkVideoSize({ width: u.width, height: u.height });
  if (!check.ok) return VERTICAL;
  return check.frame === VERTICAL ? VERTICAL : { ...check.frame, ...(typeof u.platform === "string" ? { platform: u.platform } : {}), format: u.format as VideoFormat };
}

/**
 * The frame a video job is made in, from what the job carries
 * (input.video_frame, written when the job was started). A job from before
 * this, or one that carries anything that is not a frame the check gives, is
 * VERTICAL.
 */
export function jobVideoFrame(input: { video_frame?: unknown } | null | undefined): VideoFrame {
  const f = input?.video_frame as Partial<VideoFrame> | null | undefined;
  if (!f || typeof f !== "object" || !f.size) return VERTICAL;
  const check = checkVideoSize(f.size);
  if (!check.ok) return VERTICAL;
  return check.frame;
}

/** Whether a frame is the vertical one every video had before 18 Nov 2026. */
export const isVertical = (f: VideoFrame): boolean => f === VERTICAL || (f.size.width === VERTICAL.size.width && f.size.height === VERTICAL.size.height);

/** The shape as the prompts name it: "vertical video (9:16)" for every video until now, "landscape video (16:9)" for a YouTube video. */
export const videoShapeWords = (f: VideoFrame): string => `${f.word} video (${f.label})`;
