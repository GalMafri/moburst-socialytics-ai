// supabase/functions/_shared/picture/contract.ts
//
// The contract between Socialytics' edge workers and the picture service on
// Vercel (12 Nov 2026): every picture job runs in the service, on ten
// routes (canvas, locate, read, finish, transcode, title read-back, since
// 16 Nov 2026 the logo set and the posts' logos, and since 17 Nov 2026 the
// slot and the cleaned slot's file), and the workers only send
// signed storage URLs and read back sizes and facts. This file imports nothing, so the
// Deno workers and the Node server can both import it and cannot drift apart.
//
// The service knows a call is ours through the database, with no shared
// secret (16 Nov 2026): the worker opens a call (open_picture_call) and sends
// its id in PICTURE_CALL_HEADER, and the service claims that id once
// (claim_picture_call) before it reads the request.
//
// The four routes that search for a logo (locate, post-logos, slot,
// slot-file: PICTURE_SEARCH_ROUTES) can work to a time budget (17 Nov 2026).
// A search costs what the client's logo and pictures make it cost, from a
// fraction of a second to tens of seconds, so no fixed amount of work to a
// call is right for every client. A worker sends PICTURE_BUDGET_HEADER with
// the time the service may work, by the service's own clock; when that time
// is used before the work is done, the service answers `unfinished` with
// how far it got, and the worker sends that back in PICTURE_FROM_HEADER on
// its next call, which carries on from there and ends in the same result.
// Both travel as headers and no request body changed, so a worker and a
// service of different ages always understand each other: a service from
// before reads neither header and works to the end as it always did, and a
// worker from before sends neither and gets the answer it always got. A
// worker asks for one search with a budget at most PICTURE_MAX_ASKS times;
// after that it asks without one, and the service works to the end.
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
/**
 * How long the service may work on a call's searches, by its own clock,
 * before it answers with how far it got: a third of the call limit. The rest
 * of the limit is for the claim, the call's reads and writes (the service
 * gives storage half the limit, counted only while storage is read or
 * written) and the one step of work that is in progress when the time is
 * used.
 */
export const PICTURE_WORK_BUDGET_MS = 20_000;
/** Carries the time, in whole milliseconds, the service may work before it answers how far it got. Only the routes that search read it. */
export const PICTURE_BUDGET_HEADER = "x-socialytics-budget";
/** Carries how far an earlier call got (a SearchSoFar as JSON), exactly as the service answered it. */
export const PICTURE_FROM_HEADER = "x-socialytics-from";
/**
 * The most calls with a budget a worker spends on one search (one design's
 * slot, one cleaned picture's slot, one post). A call that is still not
 * finished after them is followed by a call with no budget, which the
 * service works to its end and which can only be answered with a result or
 * a failure, as every call was before budgets. So no search is asked for
 * without end, whatever the service answers. Twelve budgets are four
 * minutes of the service's time on one search; the longest one measured
 * took under one (17 Nov 2026).
 */
export const PICTURE_MAX_ASKS = 12;
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

/**
 * Where the logo goes on a design (17 Nov 2026, _shared/design/logoSlot.ts).
 * The templates are a locate request's: the canvas file over the canvas
 * color first, then the template for the other ground when the job has one.
 * Each is searched for in either tone. `slot` is the found rectangle when
 * the best match is the logo by the existing test (`from` "drawn"), else
 * the rectangle the canvas carried (`from` "canvas"); `of` is the file
 * whose shape the slot has. `canvas` is that canvas rectangle in the
 * design's pixels. `drawn`, `score`, `matched`, `index` and `scores` are
 * the best match whatever it scored, for review; `index` is the template
 * that gave it.
 */
export type SlotRequest = PictureMeta & { design: string; placement: Placement; scales: [number, number]; templates: [LogoTemplate] | [LogoTemplate, LogoTemplate] };
export type SlotResult = {
  slot: Rect; from: "drawn" | "canvas"; of: LogoFileName; index: number;
  frame: [number, number]; canvas: Rect;
  drawn: Rect; score: number; matched: LogoFileName; scores: number[];
};
/** One file that may be stamped. `last`: a made copy the client's own posts do not show, tried after the others. */
export type StampFile = { file: LogoFileName; logo: string; last?: boolean };
/**
 * The cleaned slot: `picture` is the design with the model's drawing taken
 * out, `rect` the slot in `frame` pixels, `of` the listed file whose shape
 * the slot has, `files` one to three files in stamp order, each name once.
 * `drawn` names the listed file and the color of the template that found
 * the drawing, which is then looked for again at the slot.
 *
 * The answer: `ground` is the picture's own color under the slot (null when
 * the slot has no pixel on the picture) and `flat` how much of the slot is
 * near it; `file` is the first file whose whole parts all show there, null
 * when none does; `rect` is where it is stamped, in `frame` pixels; `shows`
 * is each file's weakest whole part against the ground. `inks` and `fits`
 * are the facts of every listed file, whichever was named (17 Nov 2026): a
 * carousel's slides are stamped with one file, chosen over all their
 * grounds by the worker (_shared/design/carouselLogo.ts), which needs each
 * file's exact colors and its own rectangle in this slot for that. A
 * service from before that day answers neither.
 */
export type SlotFileRequest = PictureMeta & {
  picture: string; rect: Rect; frame: [number, number]; of: LogoFileName;
  files: StampFile[];
  drawn?: { file: LogoFileName; ground: Rgb };
} & FirstPictureAsk;
export type SlotFileResult = {
  ground: Rgb | null; flat: number;
  file: LogoFileName | null; rect: Rect;
  shows: Partial<Record<LogoFileName, number>>;
  /** Each listed file's whole exposed ink colors (wholeInksOf): what a ground is tested against. */
  inks: Partial<Record<LogoFileName, Rgb[]>>;
  /** Where each listed file would be stamped in this slot, in `frame` pixels (fitRect). */
  fits: Partial<Record<LogoFileName, Rect>>;
  drawn?: { score: number; found: boolean };
  composed?: FirstPictureFacts;
};
/**
 * The first picture as the base (17 Nov 2026, _shared/design/firstPicture.ts).
 * A cleaned-slot request may carry `first`, the design as the model first
 * drew it (a GET link), and `out`, where the composed picture goes (an
 * upload link): both or neither. The service then composes the first
 * picture with the cleaned picture's slot, stores it at `out`, and reads
 * the slot on that composed picture, so everything the answer says is about
 * the picture that is delivered. It composes only at a rectangle the logo
 * was removed from: the found drawing's (the request carries `drawn`, and
 * the drawing is looked for again on the composed picture), or one inside
 * which the two pictures show the removal, which the service measures
 * itself. When no picture is composed nothing is kept and the slot is read
 * on the cleaned picture, as without the two fields. A request without them
 * is answered exactly as before.
 */
export type FirstPictureAsk = { first?: string; out?: string };
/**
 * What composing came to. `made` false: there is no composed picture, and
 * `why` says so: the first picture could not be read ("first"), the two
 * pictures are not one size ("size"), the slot has no place or no ring on
 * the picture ("slot"), the drawing was not found at the slot and the two
 * pictures do not show a removal inside it ("removal"), the ring around the
 * slot does not show the same thing in both pictures ("join"), or the
 * composed picture could not be stored ("store"). `share` is the part of
 * the picture the patch covers, `join` the ring's mean difference in color
 * levels after the correction, `removed` the share of the slot's cells on
 * which the two pictures are far apart (absent when it was not measured),
 * and `box` the patch's bounds in the picture's pixels: outside it the
 * composed picture is the first picture exactly.
 */
export type FirstPictureFacts = { made: boolean; why?: "first" | "size" | "slot" | "removal" | "join" | "store"; share: number; join: number; removed?: number; box?: Rect };
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

/** Where a file matched best in one finished search, and its score. */
export type SearchMatch = { x: number; y: number; width: number; height: number; score: number };
/**
 * How far the searches of one picture got. `of` is the service's own mark of
 * what was being searched (the picture, the files, the placement and the
 * sizes): a call that asks for anything else starts from the beginning.
 * `done` holds each finished search in the order sent; `at` says how far the
 * first pass of the next one got. A worker keeps it and sends it back as it
 * is, and reads nothing from it.
 */
export type SearchSoFar = { of: string; done: SearchMatch[]; at?: { size: number; row: number; best: SearchMatch } };
/**
 * What a call that worked to a budget answers when the time was used first.
 * `search` is how far the search in progress got. For post-logos, `posts`
 * holds the posts the call finished, in the order sent, and `search` belongs
 * to the post after them (absent when the time was used between two posts).
 */
export type Unfinished = { search?: SearchSoFar; posts?: Array<PostLogo | null> };

/** One to four of a client's posts, searched as a design is: the stored file's search first. */
export type PostLogosRequest = PictureMeta & {
  posts: string[]; placement: Placement; scales: [number, number];
  searches: [LogoTemplate] | [LogoTemplate, LogoTemplate]; compare: LogoCompare[];
};
export type PostLogo = { found: false; score: number }
  | { found: true; score: number; matched: LogoFileName; rect: Rect; gaps: Partial<Record<LogoFileName, number>>; shows: LogoFileName; ground: Rgb; flat: number };
/** One entry per post, in the order sent; null for a post that could not be read. */
export type PostLogosResult = { posts: Array<PostLogo | null> };

export type PictureRoute = "canvas" | "locate" | "read" | "finish" | "transcode" | "title-read" | "logo-set" | "post-logos" | "slot" | "slot-file";
export const PICTURE_ROUTES: readonly PictureRoute[] = ["canvas", "locate", "read", "finish", "transcode", "title-read", "logo-set", "post-logos", "slot", "slot-file"];
export type PictureRequests = { canvas: CanvasRequest; locate: LocateRequest; read: ReadRequest; finish: FinishRequest; transcode: TranscodeRequest; "title-read": TitleReadRequest; "logo-set": LogoSetRequest; "post-logos": PostLogosRequest; slot: SlotRequest; "slot-file": SlotFileRequest };
export type PictureResults = { canvas: CanvasResult; locate: LocateResult; read: ReadResult; finish: FinishResult; transcode: TranscodeResult; "title-read": TitleReadResult; "logo-set": LogoSetResult; "post-logos": PostLogosResult; slot: SlotResult; "slot-file": SlotFileResult };
/** The routes that search for a logo: the ones that read a budget and answer how far they got. */
export type SearchRoute = "locate" | "post-logos" | "slot" | "slot-file";
export const PICTURE_SEARCH_ROUTES: readonly SearchRoute[] = ["locate", "post-logos", "slot", "slot-file"];
/** An answer has `result`, or, only for a call that sent a budget, `unfinished`. */
export type PictureAnswer<R extends PictureRoute> = { ok: true; result: PictureResults[R]; ms: number } | { ok: true; unfinished: Unfinished; ms: number } | { ok: false; reason: string };
