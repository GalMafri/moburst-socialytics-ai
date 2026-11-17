// supabase/functions/_shared/picture/contract.ts
//
// The contract between Socialytics' edge workers and the picture service on
// Vercel (12 Nov 2026): every picture job runs in the service, on eight
// routes (canvas, locate, read, finish, transcode, title read-back, and since
// 16 Nov 2026 the logo set and the posts' logos), and the workers only send
// signed storage URLs and read back sizes and facts. This file imports nothing, so the
// Deno workers and the Node server can both import it and cannot drift apart.
//
// The service knows a call is ours through the database, with no shared
// secret (16 Nov 2026): the worker opens a call (open_picture_call) and sends
// its id in PICTURE_CALL_HEADER, and the service claims that id once
// (claim_picture_call) before it reads the request.
//
// URL strings in requests are signed storage URLs: `logo`, `design`,
// `picture` and `layer` are GET URLs, and every `out` entry is a signed
// upload URL. A template's or a compare entry's `logo`, and every entry of
// `site`, `person` and `posts`, are GET URLs too. `rect` in FinishRequest is in `frame` pixels, as
// state.logo_rect and state.logo_frame are stored. `area` and `band` in
// ReadRequest are in the pixels of `picture` and of `page` respectively.

/** The production domain of the app's own Vercel project, moburst-socialytics (its domain list, read 16 Nov 2026): the picture service is a function of that project, so every push to main serves it there. */
export const PICTURE_SERVICE_URL = "https://moburst-socialytics.vercel.app";
export const PICTURE_API_BASE = "/api/picture";
/** Carries the id of the call the worker opened in the database for this attempt. */
export const PICTURE_CALL_HEADER = "x-socialytics-call";
/** How long after it is opened a call can be claimed; the same number is in claim_picture_call (the contract test compares them). */
export const PICTURE_CALL_MAX_AGE_SECONDS = 120;
/** How long the worker waits for the database to open a call before it counts the call as not opened. */
export const PICTURE_OPEN_TIMEOUT_MS = 5_000;
export const PICTURE_CALL_TIMEOUT_MS = 60_000;
export const PICTURE_RETRY_AFTER_MS = 2_000;
export const PICTURE_MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const READ_JPEG_QUALITY = 92;
export const FRAME_JPEG_QUALITY = 92;
export const KIT_JPEG_QUALITY = 90;
export const TITLE_GROUND: [number, number, number] = [70, 70, 76];
export const TITLE_ALPHA_MIN = 16;

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Rgb = [number, number, number];
export type Placement = { anchor: "left" | "center" | "right"; width: number; top: number; left?: number };

/** Every request names its job and step, for the service's log line. */
export type PictureMeta = { job: string; step: string };

export type CanvasRequest = PictureMeta & { logo: string; page: Size; placement: Placement; background: Rgb; out: { canvas: string; mask: string } };
export type CanvasResult = { rect: Rect; canvas: Size; mask: Size };

/** A file of a client's logo set: the stored file, the file for the ground the stored file was not made for, the logo in white. */
export type LogoFileName = "stored" | "other" | "white";
export type Ground = "light" | "dark";
/** One file to look for: its name in the set, its signed GET link, the color it is laid over, whether it is a person's file, and the other files that may be named when it is the match (absent: every file may be). */
export type LogoTemplate = { file: LogoFileName; logo: string; ground: Rgb; fixed?: boolean; names?: LogoFileName[] };
export type LogoCompare = { file: LogoFileName; logo: string };
/** One color of a logo file and its share of the file's ink. */
export type Ink = { color: Rgb; share: number };

/**
 * A locate request has `logo` and `background` (a job with one file), or
 * `templates` and `compare` (a job that carries a logo set), never both. The
 * first template is the canvas template; with equal scores it wins. Two
 * templates may name one file when their grounds differ. `compare` holds
 * files that are in no template.
 */
export type LocateRequest = PictureMeta & { design: string; placement: Placement; scales: [number, number] }
  & ({ logo: string; background: Rgb }
   | { templates: [LogoTemplate] | [LogoTemplate, LogoTemplate]; compare: LogoCompare[] });
/**
 * With templates the answer also names `file` (the file to stamp: the one
 * closest in color to what was drawn), `matched` (the matched template's
 * file), `scores` (one per template, in the order sent), `gaps` (the color
 * distances that were measured) and, only when the named file's shape differs
 * from the matched file's, `stamp` (the rectangle to stamp it at).
 *
 * Since 17 Nov 2026 every answer also has `ground`, the picture's own color
 * around the found rectangle (absent when there is no pixel to sample), and
 * `lost` is true when no file that may be stamped shows on it: a whole part
 * of each is under 1.5:1 there. `file` is then null. The worker makes
 * such a design again, as it does one with no found logo.
 */
export type LocateResult = {
  x: number; y: number; width: number; height: number; score: number; usual: Rect; frame: [number, number];
  file?: LogoFileName | null; matched?: LogoFileName; scores?: number[]; gaps?: Partial<Record<LogoFileName, number>>; stamp?: Rect;
  ground?: Rgb; lost?: boolean;
};
export type ReadRequest = PictureMeta & { picture: string; page: Size; band?: Rect; area?: Rect; out: { page: string; band?: string; area?: string } };
export type ReadResult = { picture: Size; page: Size; band?: Size; area?: Size };
export type FinishRequest = PictureMeta & { picture: string; logo: string; rect: Rect; frame: [number, number]; output: Size; out: string };
export type FinishResult = { picture: Size; output: Size; bytes: number };
export type TranscodeRequest = PictureMeta & { picture: string; quality: number; out: string };
export type TranscodeResult = { size: Size; bytes: number };
export type TitleReadRequest = PictureMeta & { layer: string; out: string };
export type TitleReadResult = { layer: Size; box: Rect | null; read: Size | null };

/** `logo` is the stored file, `site` up to six of the website's logo files, `person` a person's second file, `out` where the two made copies go. */
export type LogoSetRequest = PictureMeta & { logo: string; site?: string[]; person?: string; out: { other: string; white: string } };
/** `made.other` and `made.white` are null when the rule dropped that copy (nothing was written for it); `site` names the website file that is the same logo for the other ground; `person` is null when no person's file was sent or the one sent could not be read. */
export type LogoSetResult = {
  size: Size; own: Ground; both: boolean;
  made: { other: { turned: number } | null; white: { turned: number } | null };
  site: { index: number; overlap: number; size: Size } | null;
  person: { size: Size } | null;
  inks: { stored: Ink[]; other: Ink[] | null; white: Ink[] | null };
};

/** One to four of a client's posts, searched as a design is: the stored file's search first. */
export type PostLogosRequest = PictureMeta & {
  posts: string[]; placement: Placement; scales: [number, number];
  searches: [LogoTemplate] | [LogoTemplate, LogoTemplate]; compare: LogoCompare[];
};
export type PostLogo = { found: false; score: number }
  | { found: true; score: number; matched: LogoFileName; rect: Rect; gaps: Partial<Record<LogoFileName, number>>; shows: LogoFileName; ground: Rgb; flat: number };
/** One entry per post, in the order sent; null for a post that could not be read. */
export type PostLogosResult = { posts: Array<PostLogo | null> };

export type PictureRoute = "canvas" | "locate" | "read" | "finish" | "transcode" | "title-read" | "logo-set" | "post-logos";
export const PICTURE_ROUTES: readonly PictureRoute[] = ["canvas", "locate", "read", "finish", "transcode", "title-read", "logo-set", "post-logos"];
export type PictureRequests = { canvas: CanvasRequest; locate: LocateRequest; read: ReadRequest; finish: FinishRequest; transcode: TranscodeRequest; "title-read": TitleReadRequest; "logo-set": LogoSetRequest; "post-logos": PostLogosRequest };
export type PictureResults = { canvas: CanvasResult; locate: LocateResult; read: ReadResult; finish: FinishResult; transcode: TranscodeResult; "title-read": TitleReadResult; "logo-set": LogoSetResult; "post-logos": PostLogosResult };
export type PictureAnswer<R extends PictureRoute> = { ok: true; result: PictureResults[R]; ms: number } | { ok: false; reason: string };
