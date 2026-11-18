// supabase/functions/_shared/video/logoGround.ts
//
// Which of the client's logo files a video carries (18 Nov 2026). A still
// is stamped with the first file of the client's set whose whole parts show
// on the ground under its slot (design/logoSlot.ts, pickStamp). A video used
// to carry the stored file whatever its footage looked like, so a white
// wordmark went over a white desk. Now the video's logo file is chosen by
// the same rule, on the same facts: the footage's own pixels under the
// logo's place, read on frames spread over the time the logo is on screen
// (the whole clip, or the close for a closing logo). Every ground must take
// the file, so the weakest frame decides (pickStampOn, as a carousel's
// slides do).
//
// Only the client's own files are used: the stored file and the copies its
// logo set already holds (design/logoTone.ts, stampList). A client with one
// file is made exactly as before and no frame is read.
//
// Free of Deno and network imports: the video worker and the tests share it.

import type { LogoFileName, Rect, Rgb } from "../picture/contract.ts";
import { READ_RULES, stampList, type LogoSet, type Raster, type StampEntry } from "../design/logoTone.ts";
import { groundUnder, pickStampOn } from "../design/logoSlot.ts";
import { fitTo, LOGO_END, shellQuote, type FrameSize } from "./compose.ts";

/** How many frames of the footage are read under the logo's place. */
export const GROUND_FRAMES = 4;
/** How many times the frames are asked for before the video goes on with the job's own file. */
export const GROUND_TRIES = 2;
/** How long one cut of the frames may run before the video goes on with the job's own file. */
export const GROUND_MAX_MS = 10 * 60_000;
/** How often a running cut is asked about. */
export const GROUND_POLL_MS = 30_000;

/**
 * The files a video may carry, in stamp order, read against the client's
 * settings row as it is when the video is put together: only files the row's
 * set still holds for the job's logo are used, so a file the team removed
 * since the job started is never stamped. A job started since 18 Nov 2026
 * carries its list (input.stamp) and keeps those of its files the row still
 * holds; a job from before has none and takes the row's list. With no row,
 * or a row whose logo or set is not the job's file's, the job has its one
 * file. The stored file is always the job's own.
 */
export function videoStampFiles(input: { logo_path: string; stamp?: unknown }, row?: { logo_path?: unknown; logo_set?: unknown } | null): StampEntry[] {
  const one: StampEntry[] = [{ file: "stored", path: input.logo_path }];
  const live = row ? stampFor(input.logo_path, row) : null;
  if (!live) return one;
  if (!Array.isArray(input.stamp)) return live;
  const carried = input.stamp as Array<{ file?: unknown; path?: unknown }>;
  const kept = live.filter((f) => f.file === "stored" || carried.some((c) => c && c.file === f.file && c.path === f.path));
  return kept.length ? kept : one;
}

/**
 * The list a settings row gives for a logo file, read with the stills' gate
 * (logoTone.ts, jobLogos): the row's logo is that file, its set belongs to
 * it and is of a rule that is read, and a person's second file is still the
 * one the row's person key names for that logo. Null otherwise.
 */
export function stampFor(logoPath: string, row: { logo_path?: unknown; logo_set?: unknown }): StampEntry[] | null {
  const set = row.logo_set as Partial<LogoSet> | null | undefined;
  if (row.logo_path !== logoPath || !set || typeof set !== "object" || set.of !== logoPath) return null;
  if (!READ_RULES.includes(set.rule as number)) return null;
  const other = set.other && typeof set.other.path === "string" && set.other.path ? set.other : null;
  if (other?.from === "person" && !(set.person && set.person.path === other.path && set.person.of === logoPath)) return null;
  return stampList(logoPath, set);
}

/** The logo's place on the frame, kept inside it: what is read on each frame. Null when nothing of it is on the frame. */
export function groundRect(box: { x: number; y: number; width: number }, height: number, frame: FrameSize): Rect | null {
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const right = Math.min(frame.width, Math.round(box.x + box.width)), bottom = Math.min(frame.height, Math.round(box.y + height));
  return right - x >= 2 && bottom - y >= 2 ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * The bash script that cuts the logo's place out of GROUND_FRAMES frames of
 * the footage, filled into the video's frame exactly as the join fills it
 * (compose.ts, fitTo), and uploads each as a PNG. The frames are spread over
 * the time the logo is on screen: the whole clip, or for a closing logo the
 * last LOGO_END.lead seconds. Its last line is "GROUNDS <count>".
 */
export function groundsScript(input: { footageUrl: string; frame: FrameSize; rect: Rect; end: boolean; uploads: string[] }): string {
  const { rect } = input;
  const crop = `${fitTo(input.frame)},crop=${rect.width}:${rect.height}:${rect.x}:${rect.y}`;
  const n = input.uploads.length;
  return [
    "set -euo pipefail",
    "command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null)",
    "W=$(mktemp -d) && cd \"$W\"",
    `curl -fsSL --retry 3 -o clip.mp4 ${shellQuote(input.footageUrl)}`,
    "D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 clip.mp4)",
    ...input.uploads.flatMap((url, i) => {
      const share = ((i + 0.5) / n).toFixed(4);
      const at = input.end
        ? `awk -v d="$D" 'BEGIN { s = d - ${LOGO_END.lead}; if (s < 0) s = 0; printf "%.2f", s + (d - s) * ${share} }'`
        : `awk -v d="$D" 'BEGIN { printf "%.2f", d * ${share} }'`;
      return [
        `T=$(${at})`,
        `ffmpeg -hide_banner -loglevel error -y -ss "$T" -i clip.mp4 -frames:v 1 -vf ${shellQuote(crop)} ground${i}.png`,
        `curl -fsS --retry 3 -X PUT -H 'Content-Type: image/png' -H 'x-upsert: true' --data-binary @ground${i}.png ${shellQuote(url)} >/dev/null`,
      ];
    }),
    `echo "GROUNDS ${n}"`,
  ].join("\n");
}

/** Whether the script's reply says every frame was cut and uploaded. */
export function parseGrounds(reply: string, count: number): boolean {
  const m = /GROUNDS\s+(\d+)/.exec(reply);
  return !!m && Number(m[1]) === count;
}

/** The ground under the logo's place on each frame read (each raster is the place itself), as logoSlot.ts reads a still's. */
export function groundsOf(rasters: Raster[]): Rgb[] {
  const out: Rgb[] = [];
  for (const r of rasters) {
    const g = groundUnder(r, { x: 0, y: 0, width: r.width, height: r.height });
    if (g) out.push(g.ground);
  }
  return out;
}

/** What a video keeps about its logo file: the file, its path and size, the grounds read and how each file showed on the weakest. */
export type VideoLogoPick = {
  file: LogoFileName | null;
  path: string;
  size: [number, number];
  by: "one" | "grounds" | "none" | "unread" | "timeout";
  /** Why no ground was read, for the job's record. */
  why?: string;
  grounds?: Rgb[];
  shows?: Partial<Record<LogoFileName, number>>;
};

/**
 * The file the video carries. `files` are the stamp list with each file's
 * whole-part colors and size; `grounds` the footage's ground under the
 * logo's place on each frame read. The first file that shows whole on every
 * ground, else the first with no part lost on any (pickStampOn). With no
 * file that shows, or no ground read, the job's own file, as before: the
 * clip is paid for, so the video is never stopped for this.
 */
export function chooseVideoLogo(
  files: Array<StampEntry & { inks: Rgb[]; size: [number, number] }>,
  grounds: Rgb[],
  own: { path: string; size: [number, number] },
): VideoLogoPick {
  if (!grounds.length) return { file: null, path: own.path, size: own.size, by: "unread" };
  const picked = pickStampOn(files.map((f) => ({ file: f.file, inks: f.inks, ...(f.last ? { last: true } : {}) })), grounds);
  const hit = picked.file ? files.find((f) => f.file === picked.file) : undefined;
  if (!hit) return { file: null, path: own.path, size: own.size, by: "none", grounds, shows: picked.shows };
  return { file: hit.file, path: hit.path, size: hit.size, by: "grounds", grounds, shows: picked.shows };
}

/**
 * Where the picked file goes: the place computed for its own proportions,
 * moved so its middle is the middle of the stored file's place, as a still's
 * file of another shape is (logoTone.ts, stampRect).
 */
export function centeredIn<T extends { y: number; width: number }>(placed: T, size: [number, number], slot: { y: number; width: number }, slotSize: [number, number]): T {
  if (size[0] === slotSize[0] && size[1] === slotSize[1]) return placed;
  const slotHeight = (slot.width * slotSize[1]) / slotSize[0], height = (placed.width * size[1]) / size[0];
  return { ...placed, y: Math.round(slot.y + slotHeight / 2 - height / 2) };
}

/** A sandbox script's state (sandbox.ts, checkScript). */
export type GroundScriptState = { state: "running" } | { state: "finished"; reply: string } | { state: "failed"; reason: string };

/** The services the pick uses: the settings row, storage, the sandbox and the clock. */
export interface GroundDeps {
  liveRow(): Promise<{ logo_path?: unknown; logo_set?: unknown } | null>;
  footageUrl(): Promise<string>;
  prepareUploads(count: number): Promise<{ paths: string[]; uploads: string[] }>;
  start(script: string): Promise<string>;
  check(session: string): Promise<GroundScriptState>;
  end(session: string): Promise<void>;
  save(): Promise<void>;
  readFrame(path: string): Promise<Raster>;
  /** A logo file's whole-part colors and size; throws when its pixels cannot be read. */
  readLogo(path: string): Promise<{ inks: Rgb[]; size: [number, number] }>;
  now(): number;
  log(message: string): void;
}

type GroundKept = { tries?: number; session?: string; paths?: string[]; started_at?: number; checked_at?: number; errors?: string[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * The logo file a video carries, decided while it is put together. Never
 * throws, so nothing here spends one of the job's tries: any failure (the
 * row, storage, the sandbox, a frame, a file) is a failed cut, the next pass
 * cuts again, and after GROUND_TRIES the video carries the job's own file. A
 * cut still running after GROUND_MAX_MS is ended and the job's own file is
 * carried. Null while a cut is under way (the step runs again on a later
 * pass). What it keeps is on `state.logo_ground`.
 */
export async function pickVideoLogo(
  deps: GroundDeps,
  state: Record<string, any>,
  input: { logo_path: string; logo_size: [number, number]; stamp?: unknown },
  box: { x: number; y: number; width: number; end: boolean },
  frame: FrameSize,
): Promise<VideoLogoPick | null> {
  const own = { path: input.logo_path, size: input.logo_size };
  const ownPick = (by: VideoLogoPick["by"], why?: string): VideoLogoPick => ({ file: null, ...own, by, ...(why ? { why } : {}) });
  let files: StampEntry[];
  try {
    files = videoStampFiles(input, await deps.liveRow());
  } catch (e) {
    deps.log(`logo ground: settings not read: ${message(e)}`);
    files = videoStampFiles(input, null);
  }
  if (files.length < 2) return ownPick("one");
  const rect = groundRect(box, Math.round((box.width * own.size[1]) / own.size[0]), frame);
  if (!rect) return ownPick("unread", "the logo's place is off the frame");
  const g: GroundKept = (state.logo_ground ??= {});
  const save = async () => { try { await deps.save(); } catch (e) { deps.log(`logo ground: state not saved: ${message(e)}`); } };
  // A cut that failed: the next pass cuts again, until the tries are used.
  const failed = (e: unknown): VideoLogoPick | null => {
    const why = message(e);
    deps.log(`logo ground: ${why}`);
    g.errors = [...(g.errors ?? []), why].slice(-3);
    delete g.session; delete g.started_at; delete g.paths;
    return (g.tries ?? 0) >= GROUND_TRIES ? ownPick("unread", why) : null;
  };
  // The session is let go of, and that is saved, before it is ended.
  const letGo = async (): Promise<void> => {
    const session = g.session!;
    delete g.session;
    await save();
    try { await deps.end(session); } catch (e) { deps.log(`logo ground: session not ended: ${message(e)}`); }
  };

  if (!g.session) {
    if ((g.tries ?? 0) >= GROUND_TRIES) return ownPick("unread", g.errors?.[g.errors.length - 1]);
    g.tries = (g.tries ?? 0) + 1;
    try {
      const footageUrl = await deps.footageUrl();
      const { paths, uploads } = await deps.prepareUploads(GROUND_FRAMES);
      g.paths = paths;
      g.session = await deps.start(groundsScript({ footageUrl, frame, rect, end: box.end, uploads }));
      g.started_at = g.checked_at = deps.now();
    } catch (e) {
      return failed(e);
    }
    await save();
    return null;
  }

  const now = deps.now();
  if (typeof g.checked_at === "number" && now - g.checked_at < GROUND_POLL_MS) return null;
  g.checked_at = now;
  let r: GroundScriptState;
  try {
    r = await deps.check(g.session);
  } catch (e) {
    await letGo();
    return failed(e);
  }
  if (r.state === "running") {
    if (typeof g.started_at === "number" && now - g.started_at > GROUND_MAX_MS) {
      await letGo();
      deps.log("logo ground: the frames were not cut in time");
      return ownPick("timeout", "the frames were not cut in time");
    }
    return null;
  }
  const paths = g.paths ?? [];
  await letGo();
  if (r.state !== "finished" || !parseGrounds(r.reply, paths.length)) return failed(r.state === "failed" ? r.reason : `frames not cut: ${r.reply.slice(0, 200)}`);
  try {
    const rasters: Raster[] = [];
    for (const p of paths) rasters.push(await deps.readFrame(p));
    const read: Array<StampEntry & { inks: Rgb[]; size: [number, number] }> = [];
    for (const f of files) {
      // A file whose pixels cannot be read is left out.
      try { read.push({ ...f, ...(await deps.readLogo(f.path)) }); } catch (e) { deps.log(`logo ground: ${f.file} file not read: ${message(e)}`); }
    }
    const picked = chooseVideoLogo(read, groundsOf(rasters), own);
    deps.log(`logo file ${picked.file ?? "own"} (${picked.by}) on grounds ${JSON.stringify(picked.grounds ?? [])}`);
    return picked;
  } catch (e) {
    return failed(e);
  }
}
