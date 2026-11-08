// supabase/functions/_shared/strategy/deck.ts
//
// A strategy as a Moburst-branded Google Slides deck (spec: docs/superpowers/
// specs/2026-11-03-strategy-v2-design.md, section 4), built the way Google's
// merge guide documents it: a copy of the template, filled with one
// batchUpdate (duplicateObject for each extra slide, replaceAllText and
// replaceAllShapesWithImage scoped to each slide with pageObjectIds,
// deleteObject for the template's own archetype slides). The template is
// never touched.
//
// The template (assets/strategy-deck/build_template.py) holds one archetype
// slide per layout, each marked by a {{a:<name>}} text: the cover (for a one-
// or two-line title), the Strategy divider, card rows of 1 to 5 with and
// without a chart strip, "Where we start", the four-week flow and the close. Card text follows the system's line budgets: code
// measures every field with Geist's metrics, and a row whose fields do not fit
// its cards is spread over more slides of wider cards, never set in a smaller
// font. People's versions of sections win, as on the page.

import { bodyLines, cardTextWidth, DECK_LAYOUT } from "./deckLayout.ts";
import { mixChart, startChart, type RankedRow } from "./charts.ts";
import { publicWindowLine, type PlatformFigures } from "./basis.ts";
import { avoidSourceWords, dayWords, editShown, targetLine, type Goal } from "./sections.ts";
import { pillarSectionKey, platformSectionKey, type Cadence } from "./platforms.ts";
import type { CompanyFigures } from "./publicRead.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type Weight = "Light" | "Medium" | "Bold";
/** Width in points of a text at a size and Geist weight. */
export type Measure = (text: string, size: number, weight: Weight) => number;

/** The stored strategy and people's versions, as the deck reads them. */
export interface DeckInput {
  client: string;
  /** The client's logo, already a fetchable image link, or null. */
  logo: string | null;
  written_at: string;
  sections: Record<string, unknown>;
  edits: Array<{ section_key: string; text: string; value?: unknown }>;
  platforms: Array<{ platform: string; state: string; cadence?: Cadence | null; figures?: PlatformFigures | null; competitors?: CompanyFigures[] }>;
  pillars: Array<{ name: string; share: number | null }>;
}

export interface Card { label: string; body: string }
export interface PlannedSlide {
  archetype: string;
  text: Record<string, string>;
  /** Image tokens and the chart (or "logo") that fills each. */
  images: Record<string, string>;
}
export interface DeckPlan {
  slides: PlannedSlide[];
  charts: Record<string, { svg: string; width: number }>;
  /** Fields that did not fit even a card of their own, for the job's log. */
  over: string[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const items = (v: unknown): Any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const bullets = (xs: string[]) => xs.map((x) => `• ${x}`).join("\n");
const DAY = 86_400_000;

/** The deck's name in Drive: "Acme | Social Strategy | Nov 2026". */
export function deckName(client: string, writtenAt: string): string {
  const d = new Date(writtenAt);
  return `${client} | Social Strategy | ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

/** Lines a text takes at a width: its own line breaks and the wrap. */
export function linesOf(measure: Measure, text: string, size: number, weight: Weight, width: number): number {
  let total = 0;
  for (const para of String(text).split("\n")) {
    let n = 1, cur = "";
    for (const word of para.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (!cur || measure(next, size, weight) <= width) cur = next;
      else { n++; cur = word; }
    }
    total += n;
  }
  return total;
}

/** Whether every card fits a row of n cards of this height. */
function fits(measure: Measure, cards: Card[], n: number, cardH: number): boolean {
  const L = DECK_LAYOUT;
  const w = cardTextWidth(n);
  return cards.every((c) => linesOf(measure, c.label, L.label.size, "Medium", w) <= L.label.lines
    && linesOf(measure, c.body, L.body.size, "Light", w) <= bodyLines(cardH));
}

/** Cards spread over as few slides as fit: all on one when they fit, else evenly over more, wider cards. */
export function rows(measure: Measure, cards: Card[], cardH: number, max: number = DECK_LAYOUT.maxCards): Card[][] {
  if (!cards.length) return [];
  for (let per = Math.min(cards.length, max); per >= 1; per--) {
    const slides = Math.ceil(cards.length / per);
    const size = Math.ceil(cards.length / slides);
    const chunks: Card[][] = [];
    for (let i = 0; i < cards.length; i += size) chunks.push(cards.slice(i, i + size));
    if (chunks.every((c) => fits(measure, c, c.length, cardH))) return chunks;
  }
  return cards.map((c) => [c]);
}

/** A section as the deck shows it: a person's version where there is one, else the product's. */
function shownOf(input: DeckInput) {
  const mine = new Map(input.edits.map((e) => [e.section_key, editShown(e)]));
  return (key: string): unknown => {
    const v = mine.get(key);
    return v !== null && v !== undefined && v !== "" ? v : input.sections[key];
  };
}

const cadenceWords = (c: Cadence | null | undefined) => {
  if (!c || !(c.per_week > 0)) return "";
  const n = Math.round(c.per_week * 10) / 10;
  return n >= 1 ? `${n} post${n === 1 ? "" : "s"} a week` : `1 post every ${Math.round(1 / n)} weeks`;
};

/** The brand against its competitors on the platform with the most to compare. */
function startRows(input: DeckInput): { platform: string; posts: RankedRow[]; engagement: RankedRow[] } | null {
  const candidates = input.platforms.filter((p) => p.figures && p.figures.basis !== "none" && (p.competitors ?? []).length);
  const best = candidates.sort((a, b) => (b.competitors!.length - a.competitors!.length) || (b.figures!.posts - a.figures!.posts))[0];
  if (!best) return null;
  const f = best.figures!;
  const posts: RankedRow[] = [{ name: input.client, value: f.posts_per_week, brand: true }, ...best.competitors!.map((c) => ({ name: c.company, value: c.posts_per_week, brand: false }))];
  const engagement: RankedRow[] = f.median_engagement === null ? [] : [
    { name: input.client, value: f.median_engagement, brand: true },
    ...best.competitors!.filter((c) => c.median_engagement !== null).map((c) => ({ name: c.company, value: c.median_engagement as number, brand: false })),
  ];
  return { platform: best.platform, posts, engagement };
}

function figureLine(p: DeckInput["platforms"][number]): string {
  const f = p.figures;
  if (!f) return `${p.platform}: no figures yet`;
  if (f.basis === "none") return `${p.platform}: no posts yet`;
  const parts = [`${Math.round(f.posts_per_week * 10) / 10} posts a week`];
  if (f.median_engagement !== null && f.basis !== "thin") parts.push(`${f.median_engagement} engagements per post`);
  if (f.rate !== null && f.rate_kind) parts.push(`${Math.round(f.rate * 1000) / 10}% per ${f.rate_kind}`);
  if (f.followers !== null) parts.push(`${f.followers.toLocaleString("en-US")} followers`);
  return `${p.platform}: ${parts.join(", ")}`;
}

/** Every slide of the deck, in order, with its text and charts. */
export function planDeck(input: DeckInput, measure: Measure): DeckPlan {
  const L = DECK_LAYOUT;
  const shown = shownOf(input);
  const slides: PlannedSlide[] = [];
  const charts: DeckPlan["charts"] = {};
  const over: string[] = [];
  const from = input.written_at.slice(0, 10);
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + 90 * DAY).toISOString().slice(0, 10);

  const cardSlides = (title: string, intro: string, cards: Card[], opts: { chart?: string; max?: number } = {}) => {
    const groups = rows(measure, cards, opts.chart ? L.chartCards.h : L.cards.h, opts.max);
    groups.forEach((group, i) => {
      const withChart = !!opts.chart && i === 0;
      const h = withChart ? L.chartCards.h : L.cards.h;
      if (!fits(measure, group, group.length, h)) over.push(`${title}: ${group.map((c) => c.label).join(", ")}`);
      const text: Record<string, string> = { title, intro };
      group.forEach((c, j) => { text[`c${j + 1}_label`] = c.label; text[`c${j + 1}_body`] = c.body; });
      slides.push({ archetype: `${withChart ? "chart-cards" : "cards"}-${group.length}`, text, images: withChart ? { chart: opts.chart! } : {} });
    });
  };
  const asCards = (v: unknown, label: string, make: () => Card[]): Card[] => (typeof v === "string" ? (v ? [{ label, body: v }] : []) : make());

  // 1. Cover, the title on one or two lines of 40pt Bold (a longer name keeps the cover to the name), and the divider.
  const C = L.cover.title;
  const coverLines = (t: string) => linesOf(measure, t, C.size, "Bold", C.w);
  const full = `${input.client} | Social Strategy`;
  const period = `Our plan for ${dayWords(from)} to ${dayWords(to)}`;
  const cover = coverLines(full) <= C.lines ? { title: full, period } : { title: input.client, period: `Social Strategy | ${period}` };
  if (coverLines(cover.title) > C.lines) over.push(`Cover: ${cover.title}`);
  slides.push({ archetype: `cover-${Math.min(coverLines(cover.title), C.lines)}`, text: { client_title: cover.title, period: cover.period }, images: { logo: input.logo ? "logo" : "" } });
  slides.push({ archetype: "divider", text: { divider_line: `Our social strategy for ${input.client}` }, images: {} });

  // 2. The plan.
  const goals = shown("goals");
  cardSlides("Strategy | The Plan", `What we commit to by ${dayWords(to)}`, asCards(goals, "OUR GOALS", () => items((goals as Any)?.items).map((g: Goal) => ({
    label: str(g.title), body: `${g.metric ? targetLine(g) : ""}${str(g.why) ? `\n\nWhy: ${str(g.why)}` : ""}`.trim(),
  }))), { max: 4 });

  // 3. Where we start.
  const start = startRows(input);
  if (start) charts.start = startChart(start);
  const live = input.platforms.filter((p) => p.state !== "not_now");
  const measures = shown("measures");
  const figures = live.map(figureLine).join("\n");
  slides.push({
    archetype: "start",
    text: {
      title: "Strategy | Where We Start", intro: "Our starting point on each platform",
      rows: `${figures}${typeof measures === "string" && measures ? `\n\n${measures}` : ""}`,
      data_line: publicWindowLine(live.map((p) => p.figures ?? { basis: "none" as const }), { start: new Date(Date.parse(input.written_at) - 90 * DAY).toISOString().slice(0, 10), end: from }),
    },
    images: { chart: start ? "start" : "" },
  });

  // 4. Audience and positioning.
  const audience = shown("audience");
  const positioning = shown("positioning");
  const audienceCards: Card[] = [
    ...asCards(audience, "WHO WE WRITE FOR", () => [{
      label: "WHO WE WRITE FOR",
      body: [str((audience as Any)?.who), strs((audience as Any)?.wants).length ? `They want:\n${bullets(strs((audience as Any)?.wants))}` : "", strs((audience as Any)?.where).length ? `Where: ${strs((audience as Any)?.where).join(", ")}` : ""].filter(Boolean).join("\n\n"),
    }]),
    ...asCards(positioning, "OUR POSITION", () => [{
      label: "OUR POSITION",
      body: [str((positioning as Any)?.statement), bullets(items((positioning as Any)?.points).map((p) => `vs ${str(p.vs)}: ${str(p.point)}`))].filter(Boolean).join("\n\n"),
    }]),
  ].filter((c) => c.body);
  cardSlides("Strategy | Audience and Positioning", "Who we write for and the angle we own", audienceCards, { max: 2 });

  // 5. Content pillars, with the mix.
  const pillarCards: Card[] = [];
  const mix: Array<{ name: string; current: number | null; planned: number }> = [];
  for (const p of input.pillars) {
    const v = shown(pillarSectionKey(p.name));
    if (typeof v === "string") { if (v) pillarCards.push({ label: p.name, body: v }); continue; }
    if (!v || typeof v !== "object") continue;
    const planned = Number((v as Any).planned_share);
    if (Number.isFinite(planned)) mix.push({ name: p.name, current: p.share ?? null, planned });
    pillarCards.push({ label: p.name, body: [str((v as Any).purpose), strs((v as Any).formats).length ? `Formats: ${strs((v as Any).formats).join(", ")}` : "", Number.isFinite(planned) ? `Planned share: ${planned}%` : ""].filter(Boolean).join("\n\n") });
  }
  if (mix.length) charts.mix = mixChart(mix, 2, measure);
  cardSlides("Strategy | Content Pillars", "Our content mix for the next 90 days", pillarCards, { chart: mix.length ? "mix" : undefined });

  // 6. One slide per platform posting now or new; 7. a launch flow per new platform.
  const goalItems = items((goals as Any)?.items) as Goal[];
  for (const p of live) {
    const state = p.state === "posting" ? "posting" : "new";
    const v = shown(platformSectionKey(p.platform, state));
    const goal = goalItems.find((g) => g.platform === p.platform && g.metric);
    const cards = asCards(v, "OUR PLAN", () => [
      { label: "OUR ROLE", body: [str((v as Any)?.role), cadenceWords(p.cadence) ? `Cadence: ${cadenceWords(p.cadence)}` : "", goal ? `Measure: ${targetLine(goal)}` : ""].filter(Boolean).join("\n\n") },
      { label: "WHAT WE POST", body: bullets(strs((v as Any)?.post)) },
      { label: "HOW WE CHECK", body: [str((v as Any)?.checks?.day_30) ? `At 30 days: ${str((v as Any).checks.day_30)}` : "", str((v as Any)?.checks?.day_90) ? `At 90 days: ${str((v as Any).checks.day_90)}` : ""].filter(Boolean).join("\n\n") },
    ].filter((c) => c.body));
    cardSlides(`Platforms | ${p.platform}`, state === "posting" ? `What we post on ${p.platform} and how we check it` : `How we start on ${p.platform}`, cards, { max: 3 });
    const weeks = state === "new" && v && typeof v === "object" ? strs((v as Any).first_30) : [];
    if (weeks.length === 4) {
      slides.push({ archetype: "flow", text: { title: "Platforms | First 30 Days", intro: `How we launch ${p.platform}, week by week`, w1: weeks[0], w2: weeks[1], w3: weeks[2], w4: weeks[3] }, images: {} });
    }
  }

  // 8. What we avoid, then the close.
  const avoid = shown("avoid");
  cardSlides("Strategy | What We Avoid", "Patterns we stop", asCards(avoid, "WHAT WE AVOID", () => items((avoid as Any)?.items).map((a) => ({ label: avoidSourceWords(str(a.source)).toUpperCase(), body: str(a.pattern) }))));
  slides.push({ archetype: "close", text: {}, images: {} });
  return { slides, charts, over };
}

// ── The template and the requests ───────────────────────────────────────────

const MARKER = /\{\{a:([a-z0-9-]+)\}\}/;

/** Every text of a page element. */
function textOf(el: Any): string {
  return (el?.shape?.text?.textElements ?? []).map((t: Any) => t?.textRun?.content ?? "").join("");
}

/** The template's archetype slides by name, each with its elements' ids. */
export function findArchetypes(presentation: { slides?: Any[] }): Record<string, { slideId: string; elementIds: string[] }> {
  const out: Record<string, { slideId: string; elementIds: string[] }> = {};
  for (const slide of presentation.slides ?? []) {
    const elements = (slide.pageElements ?? []) as Any[];
    const marker = elements.map(textOf).map((t) => MARKER.exec(t)?.[1]).find(Boolean);
    if (marker && !out[marker]) out[marker] = { slideId: String(slide.objectId), elementIds: elements.map((e) => String(e.objectId)) };
  }
  return out;
}

export interface DeckRequests {
  requests: Any[];
  /** For each replace request, by its index: the token it must find. */
  required: Array<{ index: number; token: string; slide: number }>;
}

/**
 * The batchUpdate for a plan on a copy of the template: duplicate each
 * planned slide's archetype (ids set by code), fill it with replaces scoped to
 * that slide, put the slides in order, and delete the archetypes.
 */
export function deckRequests(plan: DeckPlan, archetypes: ReturnType<typeof findArchetypes>, images: Record<string, string>): DeckRequests {
  const requests: Any[] = [];
  const required: DeckRequests["required"] = [];
  const ids: string[] = [];
  plan.slides.forEach((s, i) => {
    const a = archetypes[s.archetype];
    if (!a) throw new Error(`The template has no ${s.archetype} slide.`);
    const id = `deck_${String(i + 1).padStart(2, "0")}`;
    ids.push(id);
    requests.push({ duplicateObject: { objectId: a.slideId, objectIds: { [a.slideId]: id, ...Object.fromEntries(a.elementIds.map((e, j) => [e, `${id}_e${j}`])) } } });
  });
  plan.slides.forEach((s, i) => {
    const page = [ids[i]];
    const replace = (token: string, value: string) => {
      required.push({ index: requests.length, token, slide: i });
      requests.push({ replaceAllText: { containsText: { text: `{{${token}}}`, matchCase: true }, replaceText: value, pageObjectIds: page } });
    };
    replace(`a:${s.archetype}`, "");
    for (const [token, value] of Object.entries(s.text)) replace(token, value);
    for (const [token, chart] of Object.entries(s.images)) {
      const url = chart ? images[chart] : "";
      if (url) {
        required.push({ index: requests.length, token, slide: i });
        requests.push({ replaceAllShapesWithImage: { imageUrl: url, imageReplaceMethod: "CENTER_INSIDE", containsText: { text: `{{${token}}}`, matchCase: true }, pageObjectIds: page } });
      } else {
        replace(token, "");
      }
    }
  });
  // Google puts each copy right after the slide it copies, so a template
  // slide used twice has its second copy before its first, and one move of
  // every slide would list them out of their current order (refused 8 Nov
  // 2026). Each slide moves alone to its place: with the slides before it
  // already in place, it is never above its own index.
  ids.forEach((id, i) => requests.push({ updateSlidesPosition: { slideObjectIds: [id], insertionIndex: i } }));
  for (const a of Object.values(archetypes)) requests.push({ deleteObject: { objectId: a.slideId } });
  return { requests, required };
}

/** The tokens a reply says were not found: any of them means the copy did not fill. */
export function unfilled(required: DeckRequests["required"], replies: Any[]): string[] {
  return required.filter((r) => {
    const reply = replies[r.index] ?? {};
    const n = reply.replaceAllText?.occurrencesChanged ?? reply.replaceAllShapesWithImage?.occurrencesChanged ?? 0;
    return !(n >= 1);
  }).map((r) => `slide ${r.slide + 1}: {{${r.token}}}`);
}

/** Geist's weights by the face names the template's .pptx carries. */
export const WEIGHTS: Record<string, number> = { "Geist ExtraLight": 200, "Geist Light": 300, Geist: 400, "Geist Medium": 500, "Geist SemiBold": 600, "Geist Bold": 700 };

/**
 * After the template is imported, every text run's weight is set with
 * weightedFontFamily (Slides takes weight from that field, not from a face
 * name): Geist 300 for body, 400 for titles, 500 for card labels, 700 for the
 * cover title, as the .pptx names them.
 */
export function weightRequests(presentation: { slides?: Any[] }): Any[] {
  const out: Any[] = [];
  for (const slide of presentation.slides ?? []) {
    for (const el of (slide.pageElements ?? []) as Any[]) {
      for (const t of (el?.shape?.text?.textElements ?? []) as Any[]) {
        const family = t?.textRun?.style?.fontFamily ?? t?.textRun?.style?.weightedFontFamily?.fontFamily;
        const weight = WEIGHTS[String(family)];
        if (!t?.textRun || weight === undefined || t.endIndex === undefined) continue;
        out.push({
          updateTextStyle: {
            objectId: el.objectId, textRange: { type: "FIXED_RANGE", startIndex: t.startIndex ?? 0, endIndex: t.endIndex },
            style: { weightedFontFamily: { fontFamily: "Geist", weight } }, fields: "weightedFontFamily",
          },
        });
      }
    }
  }
  return out;
}
