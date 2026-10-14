// supabase/functions/_shared/canva/options.ts
//
// The rules for a post's design options, free of Deno and network imports so
// they can be tested.
//
// A request makes one design (Lital, 13 Oct: "one amazing option per design,
// not 3", for every design type). The planner writes a few briefs, strongest
// first; the first is made, and the others are kept so a design that does not
// finish is replaced from the next brief. The person who asked sees a design,
// never a failure. Only when the replacements run out with nothing finished
// does the request go to Moburst staff; the person who asked still sees it
// being prepared.

export const OPTIONS_WANTED = 1;
/** How many options a request may start in all, replacements included. */
export const MAX_CANDIDATES = 3;
export const BRIEFS_PLANNED = 3;

export interface Slide {
  /** The words set on the slide: one line, optionally a shorter second line. */
  headline: string[];
  /** The picture, described positively in the client's own visual vocabulary. */
  picture: string;
}

/** One option: a single design (headline + picture), a carousel (slides, cover first), or a video (cover and end card, with the footage between). */
export interface Brief extends Slide {
  slides?: Slide[];
  /** A video's footage, as one written shot for the video model. */
  footage?: string;
  /** A video's on-screen hook: how it looks and where it sits, from the type in the client's own posts. */
  text_style?: string;
  /** A video's length in seconds. */
  seconds?: number;
  /** The client's own posts (paths in its library) whose layout this design builds on. */
  refs?: string[];
  /** A few words naming that layout, e.g. "quote card with portrait". */
  layout?: string;
}

/** A post the client's recent designs were built on, and what they showed, so the next one differs. */
export interface RecentDesign {
  refs: string[];
  layout: string | null;
  picture: string;
}

/** Most posts of the client's library a design builds on. */
export const MAX_POSTS_PER_DESIGN = 2;

/**
 * The posts an option names ("posts": [3, 7], numbered from 1 in the order
 * the library was shown), as library paths. Unknown numbers are dropped.
 */
export function chosenPosts(raw: unknown, library: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const n of raw) {
    const i = Number(n);
    if (!Number.isInteger(i) || i < 1 || i > library.length) continue;
    const path = library[i - 1];
    if (!out.includes(path)) out.push(path);
    if (out.length >= MAX_POSTS_PER_DESIGN) break;
  }
  return out;
}

/**
 * The library posts used longest ago (or never) by the client's recent
 * designs, for a brief whose planner named none. Taking the first posts of the
 * library instead made every such design build on the same three (13 Oct).
 */
export function leastRecentPosts(library: string[], recent: RecentDesign[], count = MAX_POSTS_PER_DESIGN): string[] {
  const lastUse = new Map<string, number>();
  recent.forEach((r, age) => r.refs.forEach((p) => { if (!lastUse.has(p)) lastUse.set(p, age); }));
  // Never used first, then the ones used longest ago; library order breaks ties.
  const rank = (p: string) => (lastUse.has(p) ? recent.length - lastUse.get(p)! : -1);
  return [...library].map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).slice(0, count).map((x) => x.p);
}

/** Every brief builds on posts the planner chose, or else on the least recently used ones. */
export function withRefs(briefs: Brief[], library: string[], recent: RecentDesign[]): Brief[] {
  const used: RecentDesign[] = [...recent];
  return briefs.map((b) => {
    if (b.refs?.length) return b;
    const refs = leastRecentPosts(library, used);
    used.unshift({ refs, layout: null, picture: "" });
    return { ...b, refs };
  });
}

function withChoice(brief: Brief, o: unknown, library: string[]): Brief {
  const refs = chosenPosts((o as { posts?: unknown })?.posts, library);
  const layout = String((o as { layout?: unknown })?.layout ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return { ...brief, ...(refs.length ? { refs } : {}), ...(layout ? { layout } : {}) };
}

/** Slides in a carousel option: a cover with the hook, inner slides, and a closing slide. */
export const CAROUSEL_SLIDES = 5;

const MAX_HEADLINE_WORDS = 12;

function cleanSlide(o: unknown): Slide | null {
  const headline = Array.isArray((o as Slide)?.headline) ? (o as Slide).headline.map((l) => String(l).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 2) : [];
  const picture = String((o as Slide)?.picture ?? "").replace(/\s+/g, " ").trim();
  const words = headline.join(" ").split(" ").filter(Boolean).length;
  if (!headline.length || !picture || words > MAX_HEADLINE_WORDS) return null;
  return { headline, picture };
}

/**
 * Carousel briefs from the planner's reply: options whose every slide is well
 * formed and which have the slides asked for. The option's headline and
 * picture are its cover's.
 */
export function parseCarouselBriefs(text: string, slideCount = CAROUSEL_SLIDES, library: string[] = []): Brief[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const raw = (data as { options?: unknown })?.options;
  if (!Array.isArray(raw)) return [];
  const out: Brief[] = [];
  for (const o of raw) {
    const list = (o as { slides?: unknown })?.slides;
    if (!Array.isArray(list)) continue;
    const slides = list.map(cleanSlide);
    if (slides.length !== slideCount || slides.some((x) => !x)) continue;
    const clean = slides as Slide[];
    out.push(withChoice({ ...clean[0], slides: clean }, o, library));
  }
  return out;
}

/** A video's length, as the planner may choose it. */
export const VIDEO_SECONDS = { min: 6, max: 10, default: 8 } as const;

/**
 * Video briefs from the planner's reply: the on-screen hook, how it looks,
 * and the footage under it. An option missing any of them is dropped.
 */
export function parseVideoBriefs(text: string, library: string[] = []): Brief[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const raw = (data as { options?: unknown })?.options;
  if (!Array.isArray(raw)) return [];
  const out: Brief[] = [];
  for (const o of raw as Array<Record<string, unknown>>) {
    const footage = String(o?.footage ?? "").replace(/\s+/g, " ").trim();
    const hook = cleanSlide({ headline: o?.headline, picture: footage });
    const textStyle = String(o?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!hook || footage.length < 20 || textStyle.length < 10) continue;
    const n = Math.round(Number(o?.seconds));
    const seconds = Number.isFinite(n) ? Math.min(VIDEO_SECONDS.max, Math.max(VIDEO_SECONDS.min, n)) : VIDEO_SECONDS.default;
    out.push(withChoice({ ...hook, footage, text_style: textStyle, seconds }, o, library));
  }
  return out;
}

/** Briefs from the planner's reply, keeping only well-formed ones. */
export function parseBriefs(text: string, library: string[] = []): Brief[] {
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
    out.push(withChoice({ headline, picture }, o, library));
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

/** The steps of a design or video still being made, before the logo and words go on. */
const DESIGNING_STEPS = new Set(["generate", "references", "references_wait", "footage", "hook", "hook_check", "footage_wait"]);

function stageOf(active: JobState[]): RequestProgress["stage"] {
  if (!active.length) return "designing";
  return active.some((j) => j.step === "generate") ? "designing" : "finishing";
}

/**
 * Where an option stands, from its jobs: one job for a single design, one per
 * slide for a carousel. A carousel option is done when every slide is, and
 * has failed when any slide has.
 */
export function optionStates(jobs: Array<JobState & { option_index: number; slide_count?: number | null }>): JobState[] {
  const byOption = new Map<number, Array<JobState & { slide_count?: number | null }>>();
  for (const j of jobs) byOption.set(j.option_index, [...(byOption.get(j.option_index) ?? []), j]);
  return [...byOption.keys()].sort((a, b) => a - b).map((k) => {
    const slides = byOption.get(k)!;
    const expected = slides[0].slide_count ?? 1;
    if (slides.some((j) => j.status === "failed")) return { status: "failed", step: "failed" };
    if (slides.length >= expected && slides.every((j) => j.status === "done")) return { status: "done", step: "finished" };
    // A video counts as designing until its footage is ready; the join is its finishing.
    return { status: "running", step: slides.some((j) => DESIGNING_STEPS.has(j.step)) ? "generate" : "finishing" };
  });
}

/**
 * What the planner is told about the client's recent designs, so it builds the
 * next one on other posts of the library and shows another subject.
 */
export function recentLines(recent: RecentDesign[], library: string[]): string {
  if (!recent.length) return "";
  const lines = recent.map((r) => {
    const nums = r.refs.map((p) => library.indexOf(p) + 1).filter((n) => n > 0);
    const on = nums.length ? `built on ${nums.map((n) => `Post ${n}`).join(" and ")}` : "built on posts no longer in this set";
    return `- ${on}${r.layout ? `, ${r.layout}` : ""}: ${r.picture}`;
  });
  return [`The designs most recently made for this brand, newest first:`, ...lines].join("\n");
}

const CHOOSE_POSTS = (brand: string) =>
  `- posts: the numbers of one or two of ${brand}'s posts whose layout suits what this post says (a quote suits a quote layout, a comparison or list a comparison or list layout, a product or feature a product layout, a statement a statement layout). When the recent designs were built on a post and another suits the content as well, choose the other.\n` +
  `- layout: a few words naming the layout of the posts you chose.`;

/** The planner's instruction for carousels: every option is a set of slides read in order. */
export function carouselPlannerPrompt(args: { brand: string; platform: string; copy: string; voice: string | null; count: number; slides: number; postCount: number; recent: string; guidance?: string }): string {
  return [
    `The images are ${args.brand}'s own published posts, numbered Post 1 to Post ${args.postCount}.`,
    args.recent,
    args.guidance ?? "",
    `Plan ${args.count} different carousel options for a new ${args.platform} carousel post with this copy:`,
    `"""${args.copy}"""`,
    args.voice ? `${args.brand}'s voice: ${args.voice}` : "",
    `Each option has exactly ${args.slides} slides, read in order. Slide 1 carries the hook. The middle slides each carry one point from the copy, in the copy's order. The last slide closes with the copy's call to action or takeaway.`,
    "For each option give:",
    CHOOSE_POSTS(args.brand),
    "- slides, and for each slide:",
    `  - headline: the words set on that slide, written in ${args.brand}'s voice from the copy, in the copy's language. One line of at most 8 words, optionally a second, shorter line.`,
    "  - picture: one sentence describing the picture behind the words, using the kinds of subjects, materials, light and composition of the posts you chose, with a subject the recent designs did not show. Describe what is in the picture, all of it in sharp focus. It holds no lettering, numbers, signs, screens with writing, logos or brand marks, and names no brand. It shows no real or identifiable person and no portrait standing in for one: where a chosen post has a person, use an object, a scene or hands instead. The slides of one option share one setting and look, so they read as a series.",
    "The options differ from each other in layout or setting, and in wording. Put the strongest first: it is the one that will be made, so it should be the one you would publish.",
    `Reply with JSON only: {"options":[{"posts":[2],"layout":"...","slides":[{"headline":["line one","optional line two"],"picture":"..."}]}]}`,
  ].filter(Boolean).join("\n");
}

/**
 * The planner's instruction for a video post. The footage is made by the
 * video model with the client's own published videos as its reference, so it
 * moves and looks like them; the hook is set over it as on-screen text in the
 * type of the client's posts, with the client's logo file (13 Oct: video must
 * follow the client's own videos, carry the exact copy and logo, and have sound).
 */
export function videoPlannerPrompt(args: { brand: string; platform: string; copy: string; voice: string | null; visual?: string | null; count: number; postCount: number; recent: string; guidance?: string }): string {
  return [
    `The images are ${args.brand}'s own published posts, numbered Post 1 to Post ${args.postCount}.`,
    args.recent,
    args.guidance ?? "",
    `Plan ${args.count} different options for a new ${args.platform} vertical video post (9:16) with this copy:`,
    `"""${args.copy}"""`,
    args.visual ? `The post's planned visual: ${args.visual}` : "",
    args.voice ? `${args.brand}'s voice: ${args.voice}` : "",
    `The video is one continuous shot of footage, made by a video model that is given ${args.brand}'s own published videos as its reference, so it moves and looks like them, with sound. Over it the hook is set as on-screen text, with ${args.brand}'s logo.`,
    "For each option give:",
    CHOOSE_POSTS(args.brand),
    `- headline: the hook set on screen, written in ${args.brand}'s voice from the copy, in the copy's language. One line of at most 8 words, optionally a second, shorter line.`,
    "- text: one sentence on how the hook looks on screen, taken from the type in the posts you chose (weight, case, color, glow or shadow) and where on the frame it sits (top, center or lower third), so it reads clearly over moving footage.",
    `- footage: one shot, described for the video model in two or three sentences: what is in frame, how it moves, how the camera moves, the light and the palette, in the world of ${args.brand}'s posts and videos, all of it in sharp focus. It holds no lettering, numbers, signs, logos or brand marks, and no screens, dashboards, charts, documents or interfaces (the video model fills those with garbled writing), and names no brand. It shows no real or identifiable person: use objects, materials, places, hands or abstract motion instead. It is one whole scene: it holds no band, panel or empty area kept for the hook, which is laid over it as it is.`,
    `- seconds: the length, from ${VIDEO_SECONDS.min} to ${VIDEO_SECONDS.max}.`,
    "The options differ from each other in footage and wording. Put the strongest first: it is the one that will be made, so it should be the one you would publish.",
    'Reply with JSON only: {"options":[{"posts":[2],"layout":"...","headline":["line one","optional line two"],"text":"...","footage":"...","seconds":8}]}',
  ].filter(Boolean).join("\n");
}

/** The planner's instruction. The pictures it writes go to the image model as they are. */
export function plannerPrompt(args: { brand: string; platform: string; copy: string; voice: string | null; count: number; postCount: number; recent: string; guidance?: string }): string {
  return [
    `The images are ${args.brand}'s own published posts, numbered Post 1 to Post ${args.postCount}.`,
    args.recent,
    args.guidance ?? "",
    `Plan ${args.count} different design options for a new ${args.platform} post with this copy:`,
    `"""${args.copy}"""`,
    args.voice ? `${args.brand}'s voice: ${args.voice}` : "",
    "For each option give:",
    CHOOSE_POSTS(args.brand),
    `- headline: the words that will be set on the design, written in ${args.brand}'s voice from the post's message, in the copy's language. One line of at most 8 words, optionally a second, shorter line.`,
    "- picture: one sentence describing the picture behind the words, using the kinds of subjects, materials, light and composition of the posts you chose, with a subject the recent designs did not show. Describe what is in the picture, all of it in sharp focus. It holds no lettering, numbers, signs, screens with writing, logos or brand marks, and names no brand. It shows no real or identifiable person and no portrait standing in for one: where a chosen post has a person, use an object, a scene or hands instead.",
    "The options differ from each other in layout or picture, and in headline. Put the strongest first: it is the one that will be made, so it should be the one you would publish.",
    'Reply with JSON only: {"options":[{"posts":[2],"layout":"...","headline":["line one","optional line two"],"picture":"..."}]}',
  ].filter(Boolean).join("\n");
}
