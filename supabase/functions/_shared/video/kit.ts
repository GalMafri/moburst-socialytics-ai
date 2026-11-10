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

/** The chosen still numbers: unique, in range, in the order given, at most `max`; null when no list can be read. */
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
  return out;
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
