// supabase/functions/_shared/video/kit.ts
//
// The client's kit: up to KIT_MAX stills from their own videos, cleaned of
// captions, logos and other lettering, that every clip is given as its image
// references. The rules here (where a still is stored, what the kit's state
// is, the two questions to the models and how their answers are read) are
// free of Deno and network imports so they can be tested.

/** The most stills a kit holds. */
export const KIT_MAX = 6;
/** The fewest stills a kit needs; with fewer, the client's videos take the posts route. */
export const KIT_MIN = 2;

/** Where kit still i of a client is stored. */
export function kitPath(clientId: string, i: number): string {
  return `${clientId}/style/kit-${i}.jpg`;
}

/** missing: no kit made yet; ready: at least KIT_MIN stills; none: a kit was made with fewer. */
export type KitState = "missing" | "ready" | "none";

/** The state of the kit stored on a client's video style. */
export function kitState(videoStyle: unknown): KitState {
  const kit = (videoStyle as { kit?: unknown } | null | undefined)?.kit;
  if (!Array.isArray(kit)) return "missing";
  return kitPaths(videoStyle).length >= KIT_MIN ? "ready" : "none";
}

/** The kit's still paths; none when there is no kit. */
export function kitPaths(videoStyle: unknown): string[] {
  const kit = (videoStyle as { kit?: unknown } | null | undefined)?.kit;
  if (!Array.isArray(kit)) return [];
  return kit.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** The question that picks the kit from `count` stills, numbered from 0 in the order given. */
export function kitPickPrompt(brand: string, count: number, max: number): string {
  return [
    `These ${count} stills come from ${brand}'s own videos, numbered 0 to ${count - 1} in the order given.`,
    `Choose up to ${max} that best show ${brand}'s look: its people, places, products, light and color.`,
    "Prefer stills with the least text on screen, and choose stills that differ from each other.",
    `Answer with a JSON array of the chosen numbers only, at most ${max} of them, for example [0, 3].`,
  ].join(" ");
}

/** The chosen still numbers: unique, in range, in the order given, at most `max`; null when no list can be read or none of its numbers can be used. */
export function parseKitPick(text: string, count: number, max: number): number[] | null {
  const m = /\[[^\[\]]*\]/.exec(text);
  if (!m) return null;
  let list: unknown;
  try {
    list = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const out: number[] = [];
  for (const v of list) {
    if (out.length >= max) break;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= count) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out.length ? out : null;
}

/** The image edit that cleans one kit still. */
export function kitCleanPrompt(brand: string, sceneWords: string[]): string {
  const words = sceneWords.map((w) => w.trim()).filter(Boolean);
  const keep = words.length
    ? `The only lettering that stays is these names where they appear in the scene itself, spelled exactly as given: ${words.map((w) => `"${w}"`).join(", ")}.`
    : "No lettering stays anywhere in the picture.";
  return [
    `This is a still from one of ${brand}'s videos.`,
    "Remove all captions, subtitles, lettering, logos, watermarks and screens (phone, computer and TV screens), filling each area with what would naturally be behind it.",
    keep,
    "Keep everything else exactly as it is: the framing, the light, the color, the subjects and any motion blur.",
  ].join(" ");
}

/**
 * The route a new video takes: "posts" when the client's kit was made with
 * too few stills, else the route asked for. A kit not made yet does not
 * change the route: the video job makes the kit first (its "kit" step).
 */
export function videoRouteFor(videoStyle: unknown, requested: string | null): string | null {
  return kitState(videoStyle) === "none" ? "posts" : requested;
}

/** A kit start older than this is taken to have died, and the kit is made again. */
export const KIT_MAKE_MS = 15 * 60_000;

/**
 * What a job does about the client's kit: ready or none once it is stored;
 * wait while another job made a start under KIT_MAKE_MS ago, or while this
 * job's own cleaning (heldAt, a time in ms) is still running; else make it.
 */
export function kitNext(videoStyle: unknown, now: number, jobId?: string, heldAt?: unknown): "wait" | "make" | KitState {
  const state = kitState(videoStyle);
  if (state !== "missing") return state;
  const vs = (videoStyle ?? {}) as { kit_started_at?: unknown; kit_job?: unknown };
  const started = typeof vs.kit_started_at === "string" ? Date.parse(vs.kit_started_at) : NaN;
  const fresh = (t: number) => Number.isFinite(t) && now - t < KIT_MAKE_MS;
  if (fresh(started) && (jobId === undefined || vs.kit_job !== jobId)) return "wait";
  if (typeof heldAt === "number" && fresh(heldAt)) return "wait";
  return "make";
}

/** The stills to clean: the model's pick, or the first `max` when its answer cannot be used. */
export function kitChosen(text: string, count: number, max: number): number[] {
  return parseKitPick(text, count, max) ?? Array.from({ length: Math.min(count, max) }, (_, i) => i);
}

/** The kit from each picked still's clean path (null when it was dropped): the clean ones in order, or none with fewer than KIT_MIN. */
export function kitKept(cleaned: Array<string | null>): string[] {
  const kept = cleaned.filter((p): p is string => typeof p === "string" && p.length > 0);
  return kept.length >= KIT_MIN ? kept : [];
}

/**
 * A video job's input moved to the posts route: nothing taken from the
 * client's filmed videos stays (the same as startVideoOption with no style):
 * the logo shows at its spot in the posts, no people, no scene words.
 */
export function postsRouteInput<T extends Record<string, unknown>>(input: T): T {
  return { ...input, video_route: "posts", show_logo: true, logo_at: null, logo_width: null, people: "none", scene_words: [] };
}

/** The most stills one background cleaning takes on; the rest wait for the next pass. */
export const KIT_BATCH = 3;
/** Claims of the kit by one job before it is stored as [] (the client's videos then take the posts route). */
export const MAX_KIT_TRIES = 3;

/**
 * What the kit's maker does next, from each picked still's outcome so far
 * (`done[i]`: its clean path, null when dropped, undefined while not done)
 * and how many times it has claimed the kit: store it once every still is
 * done; give up (store []) once its tries are spent; else clean the next
 * KIT_BATCH stills not done yet.
 */
export function kitWork(count: number, done: ReadonlyArray<string | null | undefined>, tries: number): { kind: "store" } | { kind: "spent" } | { kind: "clean"; todo: number[] } {
  const todo: number[] = [];
  for (let i = 0; i < count; i++) if (done[i] === undefined) todo.push(i);
  if (!todo.length) return { kind: "store" };
  if (tries > MAX_KIT_TRIES) return { kind: "spent" };
  return { kind: "clean", todo: todo.slice(0, KIT_BATCH) };
}
