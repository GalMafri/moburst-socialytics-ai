// supabase/functions/_shared/picture/contract.ts
//
// The contract between Socialytics' edge workers and the picture service on
// Vercel (12 Nov 2026): every picture job (canvas, locate, read, finish,
// transcode, title read-back) runs in the service, and the workers only send
// signed storage URLs and read back sizes. This file imports nothing, so the
// Deno workers and the Node server can both import it and cannot drift apart.
//
// The service knows a call is ours through the database, with no shared
// secret (16 Nov 2026): the worker opens a call (open_picture_call) and sends
// its id in PICTURE_CALL_HEADER, and the service claims that id once
// (claim_picture_call) before it reads the request.
//
// URL strings in requests are signed storage URLs: `logo`, `design`,
// `picture` and `layer` are GET URLs, and every `out` entry is a signed
// upload URL. `rect` in FinishRequest is in `frame` pixels, as
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
export type LocateRequest = PictureMeta & { design: string; logo: string; placement: Placement; background: Rgb; scales: [number, number] };
export type LocateResult = { x: number; y: number; width: number; height: number; score: number; usual: Rect; frame: [number, number] };
export type ReadRequest = PictureMeta & { picture: string; page: Size; band?: Rect; area?: Rect; out: { page: string; band?: string; area?: string } };
export type ReadResult = { picture: Size; page: Size; band?: Size; area?: Size };
export type FinishRequest = PictureMeta & { picture: string; logo: string; rect: Rect; frame: [number, number]; output: Size; out: string };
export type FinishResult = { picture: Size; output: Size; bytes: number };
export type TranscodeRequest = PictureMeta & { picture: string; quality: number; out: string };
export type TranscodeResult = { size: Size; bytes: number };
export type TitleReadRequest = PictureMeta & { layer: string; out: string };
export type TitleReadResult = { layer: Size; box: Rect | null; read: Size | null };

export type PictureRoute = "canvas" | "locate" | "read" | "finish" | "transcode" | "title-read";
export const PICTURE_ROUTES: readonly PictureRoute[] = ["canvas", "locate", "read", "finish", "transcode", "title-read"];
export type PictureRequests = { canvas: CanvasRequest; locate: LocateRequest; read: ReadRequest; finish: FinishRequest; transcode: TranscodeRequest; "title-read": TitleReadRequest };
export type PictureResults = { canvas: CanvasResult; locate: LocateResult; read: ReadResult; finish: FinishResult; transcode: TranscodeResult; "title-read": TitleReadResult };
export type PictureAnswer<R extends PictureRoute> = { ok: true; result: PictureResults[R]; ms: number } | { ok: false; reason: string };
