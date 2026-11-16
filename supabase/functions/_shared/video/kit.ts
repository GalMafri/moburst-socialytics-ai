// supabase/functions/_shared/video/kit.ts
//
// The client's kit: up to KIT_MAX stills from their own videos, with no
// person's face and cleaned of all lettering, that every clip is given as
// its image references. A look reference: places, products, light and
// color, each still at its own framing. The rules here (where a still is
// stored, what the kit's state is, the questions to the models and how
// their answers are read) are free of Deno and network imports so they can
// be tested.

/** The most stills a kit holds. */
export const KIT_MAX = 6;
/** The fewest stills a kit needs; with fewer, the client's videos take the posts route. */
export const KIT_MIN = 2;

/** Where kit still i of a client is stored. */
export function kitPath(clientId: string, i: number): string {
  return `${clientId}/style/kit-${i}.jpg`;
}

/** Where the image model's paid edit of kit still i, in cleaning round n, is stored before the picture service makes its JPEG. */
export function kitEditPath(clientId: string, i: number, n: number): string {
  return `${clientId}/style/kit-${i}-edit-${n}.png`;
}

/**
 * The paid edits of the stills in progress, kept on the job (state.kit_edits)
 * by still and round ("i-n") until the still is done: a transcode the picture
 * service could not finish is tried again from the stored edit, and the edit
 * is never paid for twice.
 */
export type KitEdits = Record<string, string>;

/** The stored edit of still i in round n, or null when that round has not been paid for. */
export function kitEditKept(edits: unknown, i: number, n: number): string | null {
  const path = (edits as Record<string, unknown> | null | undefined)?.[`${i}-${n}`];
  return typeof path === "string" && path ? path : null;
}

/** The kept edits as stored, without any entry that is not a path. */
function keptEdits(edits: unknown): KitEdits {
  const out: KitEdits = {};
  for (const [k, v] of Object.entries((edits as Record<string, unknown> | null | undefined) ?? {})) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** The kept edits with still i's round n stored at path. */
export function kitEditsWith(edits: unknown, i: number, n: number, path: string): KitEdits {
  return { ...keptEdits(edits), [`${i}-${n}`]: path };
}

/** The kept edits without still i's, once that still is done; with a round, without that round's alone (an edit the picture service could not work with). */
export function kitEditsWithout(edits: unknown, i: number, n?: number): KitEdits {
  const gone = (k: string) => (n === undefined ? k.startsWith(`${i}-`) : k === `${i}-${n}`);
  return Object.fromEntries(Object.entries(keptEdits(edits)).filter(([k]) => !gone(k)));
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
    `Choose up to ${max} that best show ${brand}'s look: its scenes, places, products, materials, light and color.`,
    "Leave out every still that shows a person's face or a recognizable person: the kit is a look reference, and no real person may be carried into new footage.",
    "Prefer stills with the least text on screen, and choose stills that differ from each other.",
    `Answer with a JSON array of the chosen numbers only, at most ${max} of them, for example [0, 3]. Answer [] when no still qualifies.`,
  ].join(" ");
}

/** The chosen still numbers: unique, in range, in the order given, at most `max`; [] when the model chose none; null when no list can be read or none of its numbers can be used. */
export function parseKitPick(text: string, count: number, max: number): number[] | null {
  // The last list in the answer: the model may name the stills it leaves out before it answers.
  const lists = text.match(/\[[^\[\]]*\]/g);
  if (!lists) return null;
  let list: unknown;
  try {
    list = JSON.parse(lists[lists.length - 1]);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  // An empty list is an answer: no still qualifies.
  if (!list.length) return [];
  const out: number[] = [];
  for (const v of list) {
    if (out.length >= max) break;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= count) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out.length ? out : null;
}

/**
 * The image edit that cleans one kit still. A look reference, so no lettering
 * of any kind stays or is added. Neither the client's scene words nor the
 * brand's name are in it: naming words made the image model paint them.
 */
export function kitCleanPrompt(): string {
  return [
    "This is a still from a video, kept as a reference for the look of new footage.",
    "Remove all captions, subtitles, lettering, logos, watermarks and screens (phone, computer and TV screens), filling each area with what would naturally be behind it.",
    "No lettering of any kind stays anywhere in the picture, and nothing new is added: no words, signs, labels, buttons or graphics.",
    "Keep everything else exactly as it is: the framing, the light, the color, the subjects and any motion blur.",
  ].join(" ");
}

/** The longest side of a cleaned kit still. */
export const KIT_EDIT_LONG = 1536;

/**
 * The size a still is edited at: its own aspect (so the model invents nothing
 * outside the picture), the longest side KIT_EDIT_LONG, both sides multiples
 * of 16 as the image model asks, never under 16.
 */
export function kitEditSize(width: number, height: number): [number, number] {
  const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
  const to16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return w >= h ? [KIT_EDIT_LONG, to16(KIT_EDIT_LONG * h / w)] : [to16(KIT_EDIT_LONG * w / h), KIT_EDIT_LONG];
}

/** The question that reads one cleaned still back: writing left in it, and a person's face. */
export function kitStillCheckPrompt(): string {
  return "This is a still kept as a reference for the look of new footage. Two questions. " +
    "1. Is there any writing anywhere in it: letters, words, numbers, labels, signs, captions, logos or watermarks, however small or garbled? " +
    "2. Does it show a person's face or a recognizable person? " +
    'Reply with JSON only: {"writing": true or false, "face": true or false, "where": "what you saw and where it is, or empty"}';
}

/** The read-back's answer; null when it cannot be read. */
export function parseKitStillCheck(text: string): { writing: boolean; face: boolean; where: string } | null {
  const w = /"writing"\s*:\s*"?(true|false)"?/i.exec(text);
  const f = /"face"\s*:\s*"?(true|false)"?/i.exec(text);
  if (!w || !f) return null;
  const where = /"where"\s*:\s*"([\s\S]*?)"\s*}/.exec(text);
  return { writing: w[1].toLowerCase() === "true", face: f[1].toLowerCase() === "true", where: where ? where[1] : "" };
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

/**
 * The other job that holds a fresh claim on the kit (kit_started_at under
 * KIT_MAKE_MS ago), or null. Whether that job is still alive is read from its
 * own row (steps.ts endedHolder): a claim is only as good as its holder, so a
 * holder that ended (failed, canceled, finished without storing the kit) frees
 * it at once, with no 15 minute wait for the claim to lapse.
 */
export function kitHolderOf(videoStyle: unknown, now: number, jobId: string): string | null {
  const vs = (videoStyle ?? {}) as { kit_started_at?: unknown; kit_job?: unknown };
  const started = typeof vs.kit_started_at === "string" ? Date.parse(vs.kit_started_at) : NaN;
  if (!Number.isFinite(started) || now - started >= KIT_MAKE_MS) return null;
  return typeof vs.kit_job === "string" && vs.kit_job && vs.kit_job !== jobId ? vs.kit_job : null;
}

/**
 * The job's state when it takes the kit over from a holder that ended: the
 * pick, the outcomes and the paid edits the holder kept (their files are the
 * client's own, by kitPath and kitEditPath), so nothing paid for is paid for
 * again. Only for the same style (kit_of) and only when the job has no pick
 * of its own yet; the tries are the job's own.
 */
export function kitTakenOver<T extends Record<string, unknown>>(state: T, holderState: unknown, madeAt: unknown): T {
  const held = (holderState && typeof holderState === "object" && !Array.isArray(holderState) ? holderState : {}) as Record<string, unknown>;
  const of = typeof madeAt === "string" ? madeAt : null;
  if (Array.isArray(state.kit_pick) || !Array.isArray(held.kit_pick) || ((held.kit_of as string | null | undefined) ?? null) !== of) return state;
  return { ...state, kit_pick: held.kit_pick, kit_done: kitDoneOf(held.kit_done), kit_edits: keptEdits(held.kit_edits) } as T;
}

/** The kit from each picked still's clean path (null when it was dropped): the clean ones in order, or none with fewer than KIT_MIN. */
export function kitKept(cleaned: Array<string | null>): string[] {
  const kept = cleaned.filter((p): p is string => typeof p === "string" && p.length > 0);
  return kept.length >= KIT_MIN ? kept : [];
}

/**
 * A video job's input moved to the posts route: nothing taken from the
 * client's filmed videos stays (the same as startVideoOption with no style):
 * the logo shows at its spot in the posts, no people.
 */
export function postsRouteInput<T extends Record<string, unknown>>(input: T): T {
  return { ...input, video_route: "posts", show_logo: true, logo_at: null, logo_width: null, people: "none" };
}

/** The most stills one background cleaning takes on; the rest wait for the next pass. */
export const KIT_BATCH = 3;
/** Claims of the kit by one job that finished no still, before it is stored with what is clean so far ([] with fewer than KIT_MIN: the posts route). */
export const MAX_KIT_TRIES = 3;

/**
 * Each picked still's outcome, by its index in the pick: its clean path, or
 * dropped. A still not in it is pending. (An object, not an array: stills
 * finish out of order, and an array's holes come back from the row as nulls.)
 */
export type KitDone = Record<string, { path: string } | { dropped: true }>;

/** The outcomes as stored on the job; anything else is pending. */
export function kitDoneOf(raw: unknown): KitDone {
  const out: KitDone = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(k) || !v || typeof v !== "object") continue;
    const o = v as { path?: unknown; dropped?: unknown };
    if (typeof o.path === "string" && o.path) out[k] = { path: o.path };
    else if (o.dropped === true) out[k] = { dropped: true };
  }
  return out;
}

/** How many picked stills are done (cleaned or dropped). */
export function kitDoneCount(done: KitDone): number {
  return Object.keys(kitDoneOf(done)).length;
}

/** The kit from the outcomes of `count` picked stills: the clean ones in pick order, or none with fewer than KIT_MIN. */
export function kitKeptFrom(count: number, done: KitDone): string[] {
  const d = kitDoneOf(done);
  return kitKept(Array.from({ length: count }, (_, i) => {
    const o = d[String(i)];
    return o && "path" in o ? o.path : null;
  }));
}

/**
 * The kit's tries at a new claim. A try is a claim that finished no still
 * for a reason about the stills: at each claim the stills done now are
 * compared with those done at the claim before (`seen`); none new since
 * then costs that claim a try, unless it is spared (`spared`: it ended for
 * a reason outside its stills, the picture service unavailable, the image
 * model busy, or a call the picture service refused, kept on the job by
 * the cleaning, kitStep.ts). A wait is never a spent try, and a refused
 * call spends a try of the job instead. The first claim has nothing before
 * it, so costs nothing. A claim whose run died left no mark, so it is a try.
 */
export function kitClaim(prev: { tries?: unknown; seen?: unknown; spared?: unknown }, doneNow: number): { tries: number; seen: number } {
  const tries = typeof prev.tries === "number" ? prev.tries : 0;
  if (typeof prev.seen !== "number") return { tries, seen: doneNow };
  const spent = doneNow <= prev.seen && prev.spared !== true;
  return { tries: spent ? tries + 1 : tries, seen: doneNow };
}

/**
 * The job's state at a new claim of the kit: the kit in progress for this
 * style (kitForStyle), its tries counted (kitClaim), and the claim before's
 * mark (kit_spared) forgotten, so only the claim that carried it is spared.
 */
export function kitClaimed<T extends Record<string, unknown>>(state: T, madeAt: unknown): T {
  const { kit_spared: spared, ...st } = kitForStyle(state, madeAt) as Record<string, unknown>;
  const claim = kitClaim({ tries: st.kit_tries, seen: st.kit_seen, spared }, kitDoneCount(kitDoneOf(st.kit_done)));
  return { ...st, kit_tries: claim.tries, kit_seen: claim.seen } as unknown as T;
}

/**
 * What the kit's maker does next, from the number of picked stills (null
 * before the pick), their outcomes so far and its tries (kitClaim): store it
 * once every still is done; give up (store what is clean so far, [] with
 * fewer than KIT_MIN) once MAX_KIT_TRIES claims finished nothing, whether or
 * not they reached the pick; pick when there is no pick yet; else clean the
 * next KIT_BATCH stills not done yet.
 */
export function kitWork(count: number | null, done: KitDone, tries: number): { kind: "store" } | { kind: "spent" } | { kind: "pick" } | { kind: "clean"; todo: number[] } {
  const d = kitDoneOf(done);
  const todo: number[] = [];
  for (let i = 0; i < (count ?? 0); i++) if (!d[String(i)]) todo.push(i);
  if (count !== null && !todo.length) return { kind: "store" };
  if (tries >= MAX_KIT_TRIES) return { kind: "spent" };
  if (count === null) return { kind: "pick" };
  return { kind: "clean", todo: todo.slice(0, KIT_BATCH) };
}

/**
 * A kit in progress belongs to the style it was picked from (its made_at):
 * when the style was learned again since, the pick, the outcomes and the
 * paid edits kept for the old pick start over (the tries stay). Returns the job state to use.
 */
export function kitForStyle<T extends Record<string, unknown>>(state: T, madeAt: unknown): T {
  const of = typeof madeAt === "string" ? madeAt : null;
  if (state.kit_of === of) return state;
  const { kit_pick: _pick, kit_done: _done, kit_seen: _seen, kit_edits: _edits, ...rest } = state;
  return { ...rest, kit_of: of } as unknown as T;
}
