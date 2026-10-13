// supabase/functions/_shared/canva/options.ts
//
// The rules for a post's design options, free of Deno and network imports so
// they can be tested.
//
// A request wants three options. Each option is one job (design, then finish
// in Canva). An option that does not finish is replaced by a new one from the
// next planned brief, so the person who asked sees options, never a failure.
// Only when the replacements run out with nothing finished does the request
// go to Moburst staff; the person who asked still sees it being prepared.

export const OPTIONS_WANTED = 3;
/** How many options a request may start in all, replacements included. */
export const MAX_CANDIDATES = 6;
export const BRIEFS_PLANNED = 5;

export interface Brief {
  /** The words set on the design: one line, optionally a shorter second line. */
  headline: string[];
  /** The picture, described positively in the client's own visual vocabulary. */
  picture: string;
}

const MAX_HEADLINE_WORDS = 12;

/** Briefs from the planner's reply, keeping only well-formed ones. */
export function parseBriefs(text: string): Brief[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const raw = (data as { options?: unknown })?.options;
  if (!Array.isArray(raw)) return [];
  const out: Brief[] = [];
  for (const o of raw) {
    const headline = Array.isArray((o as Brief)?.headline) ? (o as Brief).headline.map((l) => String(l).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 2) : [];
    const picture = String((o as Brief)?.picture ?? "").replace(/\s+/g, " ").trim();
    const words = headline.join(" ").split(" ").filter(Boolean).length;
    if (!headline.length || !picture || words > MAX_HEADLINE_WORDS) continue;
    out.push({ headline, picture });
  }
  return out;
}

export type JobState = { status: "queued" | "running" | "done" | "failed"; step: string };

export interface RequestProgress {
  status: "preparing" | "ready" | "needs_staff";
  stage: "planning" | "designing" | "finishing" | "ready";
  options_ready: number;
  /** Start one more option (a replacement), from this brief. */
  start_brief: number | null;
}

/** Where a request stands, and whether it needs a replacement option, from its jobs. */
export function requestProgress(jobs: JobState[], wanted = OPTIONS_WANTED, briefCount = BRIEFS_PLANNED): RequestProgress {
  const ready = jobs.filter((j) => j.status === "done").length;
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const started = jobs.length;
  if (ready >= wanted) return { status: "ready", stage: "ready", options_ready: ready, start_brief: null };
  const stillNeeded = wanted - ready - active.length;
  if (stillNeeded > 0 && started < MAX_CANDIDATES) {
    return { status: "preparing", stage: stageOf(active), options_ready: ready, start_brief: started % Math.max(1, briefCount) };
  }
  if (active.length) return { status: "preparing", stage: stageOf(active), options_ready: ready, start_brief: null };
  return ready > 0
    ? { status: "ready", stage: "ready", options_ready: ready, start_brief: null }
    : { status: "needs_staff", stage: "designing", options_ready: 0, start_brief: null };
}

function stageOf(active: JobState[]): RequestProgress["stage"] {
  if (!active.length) return "designing";
  return active.some((j) => j.step === "generate") ? "designing" : "finishing";
}

/** The planner's instruction. The pictures it writes go to the image model as they are. */
export function plannerPrompt(args: { brand: string; platform: string; copy: string; voice: string | null; count: number }): string {
  return [
    `These images are ${args.brand}'s own published social posts.`,
    `Plan ${args.count} different design options for a new ${args.platform} post with this copy:`,
    `"""${args.copy}"""`,
    args.voice ? `${args.brand}'s voice: ${args.voice}` : "",
    "For each option give:",
    `- headline: the words that will be set on the design, written in ${args.brand}'s voice from the post's message, in the copy's language. One line of at most 8 words, optionally a second, shorter line.`,
    "- picture: one sentence describing the picture behind the words, using only the kinds of subjects, materials, light and composition these posts use. Describe what is in the picture. It holds no lettering, numbers, signs, screens with writing, logos or brand marks, and names no brand.",
    "Each option has a different picture and a different headline.",
    'Reply with JSON only: {"options":[{"headline":["line one","optional line two"],"picture":"..."}]}',
  ].filter(Boolean).join("\n");
}
