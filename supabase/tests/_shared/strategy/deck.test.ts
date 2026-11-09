// @vitest-environment node
// The deck (spec: docs/superpowers/specs/2026-11-03-strategy-v2-design.md,
// section 4): the slides for 1, 3 and 6 platforms and 2 to 6 pillars; cards
// spread over more, wider cards when a field is over its measured budget,
// never a smaller font; every replace scoped to its slide; a copy whose
// tokens were not all found is not kept; the template's weights set by name.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deckName, deckRequests, findArchetypes, linesOf, planDeck, rows, unfilled, weightRequests, type DeckInput, type Measure } from "../../../functions/_shared/strategy/deck";
import { DECK_LAYOUT, cardTextWidth } from "../../../functions/_shared/strategy/deckLayout";

/** Geist at about half an em a character, as mbdeck's fallback measures it. */
const measure: Measure = (text, size) => text.length * 0.5 * size;
const goal = (platform: string, title = "Grow engagement per post") => ({ title, why: "Carousels beat the usual 2.7x.", platform, metric: "median_engagement", direction: "above", baseline: 42, by: "2027-02-01" });
const figures = (platform: string) => ({ platform, basis: "public" as const, posts: 20, posts_per_week: 1.6, median_engagement: 40, rate: null, rate_kind: null, followers: 1200 });
const PLATFORMS = ["Instagram", "TikTok", "LinkedIn", "Facebook", "YouTube", "X"];

function input(platforms: number, pillars: number, over: Partial<DeckInput> = {}): DeckInput {
  const live = PLATFORMS.slice(0, platforms).map((p, i) => ({ platform: p, state: i === 1 ? "new" : "posting", cadence: { per_week: 2, source: "competitors" as const }, figures: figures(p), competitors: [{ company: "BenchApp", client: false, platform: p, posts: 30, posts_per_week: 2.3, median_engagement: 18, rate_per_view: null, followers: 900 }] }));
  const names = Array.from({ length: pillars }, (_, i) => `Pillar ${i + 1}`);
  const sections: Record<string, unknown> = {
    goals: { items: [goal("Instagram"), goal("Instagram", "Post every week")] },
    audience: { who: "Rec league captains.", wants: ["Less chasing", "Fair splits", "Time back"], where: ["Instagram"] },
    positioning: { statement: "Built for the captain.", points: [{ vs: "BenchApp", point: "Useful over funny." }] },
    avoid: { items: [{ pattern: "Office photos", source: "posts" }, { pattern: "Job ads", source: "trend_profile" }] },
  };
  for (const n of names) sections[`pillar:${n}`] = { purpose: "Make captains laugh.", formats: ["carousel"], planned_share: Math.round(100 / pillars), ideas: [] };
  live.forEach((p, i) => {
    sections[`platform:${p.platform.toLowerCase()}:${i === 1 ? "new" : "posting"}`] = { role: "Our home base.", post: ["Checklists", "Truths", "Reminders"], worked: [], ...(i === 1 ? { first_30: ["w1", "w2", "w3", "w4"] } : {}), checks: { day_30: "Saves", day_90: "Follows" } };
  });
  return { client: "Acme", logo: "https://x/logo.png", written_at: "2026-11-03T10:00:00.000Z", sections, edits: [], platforms: live, pillars: names.map((name) => ({ name, share: 25 })), ...over };
}
const archetypesOf = (slides: Array<{ archetype: string }>) => slides.map((s) => s.archetype);

describe("the slides", () => {
  it("follows the plan: cover, the plan, where we start, audience, pillars with the mix, each platform, each launch, what we avoid, the close", () => {
    const plan = planDeck(input(3, 3), measure);
    expect(archetypesOf(plan.slides)).toEqual(["cover-2", "divider", "cards-2", "start", "cards-2", "chart-cards-3", "cards-3", "cards-3", "flow", "cards-3", "cards-2", "close"]);
    expect(plan.slides.map((s) => s.text.title).filter(Boolean)).toEqual([
      "Strategy | The Plan", "Strategy | Where We Start", "Strategy | Audience and Positioning", "Strategy | Content Pillars",
      "Platforms | Instagram", "Platforms | TikTok", "Platforms | First 30 Days", "Platforms | LinkedIn", "Strategy | What We Avoid",
    ]);
    expect(plan.slides[0].text).toEqual({ client_title: "Acme | Social Strategy", period: "Our plan for 3 Nov 2026 to 1 Feb 2027" });
    expect(plan.slides[2].text.c1_body).toBe("Instagram median engagement per post: 42 today, above it by 1 Feb 2027\n\nWhy: Carousels beat the usual 2.7x.");
    expect(plan.slides[3].text.data_line).toBe("Based on public posts from 5 Aug to 3 Nov 2026");
    expect(Object.keys(plan.charts).sort()).toEqual(["mix", "start"]);
    expect(plan.over).toEqual([]);
  });

  it("sizes the pillar row to the count, 2 to 6, and a single platform deck stays whole", () => {
    for (const [n, want] of [[2, ["chart-cards-2"]], [4, ["chart-cards-4"]], [5, ["chart-cards-5"]], [6, ["chart-cards-3", "cards-3"]]] as const) {
      const plan = planDeck(input(1, n), measure);
      expect(plan.slides.filter((s) => s.text.title === "Strategy | Content Pillars").map((s) => s.archetype), String(n)).toEqual(want);
    }
    expect(archetypesOf(planDeck(input(1, 2), measure).slides)).toEqual(["cover-2", "divider", "cards-2", "start", "cards-2", "chart-cards-2", "cards-3", "cards-2", "close"]);
    const six = planDeck(input(6, 3), measure);
    expect(six.slides.filter((s) => s.text.title?.startsWith("Platforms | ") && s.text.title !== "Platforms | First 30 Days")).toHaveLength(6);
  });

  it("moves a field over its measured budget to wider cards on more slides, never a smaller font", () => {
    const long = "A very long body line that goes on and on about the brand ".repeat(7).trim();
    const cards = Array.from({ length: 4 }, (_, i) => ({ label: `CARD ${i + 1}`, body: long }));
    const width4 = cardTextWidth(4);
    expect(linesOf(measure, long, DECK_LAYOUT.body.size, "Light", width4)).toBeGreaterThan(13);
    const spread = rows(measure, cards, DECK_LAYOUT.cards.h);
    expect(spread.map((r) => r.length)).toEqual([2, 2]);
    expect(rows(measure, cards.map((c) => ({ ...c, body: "Short." })), DECK_LAYOUT.cards.h).map((r) => r.length)).toEqual([4]);
    // A goal title over two lines at four across moves the plan to two slides.
    const plan = planDeck(input(1, 2, { sections: { ...input(1, 2).sections, goals: { items: Array.from({ length: 4 }, () => goal("Instagram", "Grow engagement per post on Instagram with carousels")) } } }), measure);
    expect(archetypesOf(plan.slides).slice(2, 4)).toEqual(["cards-2", "cards-2"]);
  });

  it("shows people's versions, a 2 Nov text edit as text in its card", () => {
    const plan = planDeck(input(1, 2, { edits: [
      { section_key: "audience", text: "Captains and their co-captains." },
      { section_key: "avoid", text: "x", value: { items: [{ pattern: "Memes about other apps", source: "team" }] } },
    ] }), measure);
    const audience = plan.slides.find((s) => s.text.title === "Strategy | Audience and Positioning")!;
    expect(audience.text).toMatchObject({ c1_label: "WHO WE WRITE FOR", c1_body: "Captains and their co-captains.", c2_label: "OUR POSITION" });
    const avoid = plan.slides.find((s) => s.text.title === "Strategy | What We Avoid")!;
    expect(avoid.text).toMatchObject({ c1_label: "TEAM", c1_body: "Memes about other apps" });
  });

  it("keeps the cover title to two lines of 40pt, the name alone when the full title is longer", () => {
    expect(planDeck(input(1, 2, { client: "Ab" }), (t, size) => t.length * 0.3 * size).slides[0].archetype).toBe("cover-1");
    expect(planDeck(input(1, 2, { client: "Pay The Pyper" }), measure).slides[0]).toMatchObject({ archetype: "cover-2", text: { client_title: "Pay The Pyper | Social Strategy" } });
    const long = planDeck(input(1, 2, { client: "The Very Long Brand Name Company" }), measure).slides[0];
    expect(long).toMatchObject({ archetype: "cover-2", text: { client_title: "The Very Long Brand Name Company", period: "Social Strategy | Our plan for 3 Nov 2026 to 1 Feb 2027" } });
  });

  it("names the copy for the client and the month", () => {
    expect(deckName("Acme", "2026-11-03T10:00:00.000Z")).toBe("Acme | Social Strategy | Nov 2026");
  });
});

describe("the requests", () => {
  const el = (id: string, text: string) => ({ objectId: id, shape: { text: { textElements: [{ startIndex: 0, endIndex: text.length, textRun: { content: text, style: { fontFamily: "Geist Light" } } }] } } });
  const template = { slides: ["cover-2", "divider", "cards-2", "cards-3", "chart-cards-2", "chart-cards-3", "start", "flow", "close"].map((a, i) => ({ objectId: `s${i}`, pageElements: [el(`m${i}`, `{{a:${a}}}`), el(`t${i}`, "{{title}}")] })) };

  it("duplicates each slide's archetype with ids set by code, scopes every replace to its slide, orders the slides and deletes the archetypes", () => {
    const plan = planDeck(input(1, 2), measure);
    const arch = findArchetypes(template);
    expect(arch["cards-2"]).toEqual({ slideId: "s2", elementIds: ["m2", "t2"] });
    const { requests, required } = deckRequests(plan, arch, { start: "https://signed/start.png", mix: "https://signed/mix.png", logo: "https://signed/logo.png" });
    const dups = requests.filter((r) => r.duplicateObject);
    expect(dups).toHaveLength(plan.slides.length);
    expect(dups[0]).toEqual({ duplicateObject: { objectId: "s0", objectIds: { s0: "deck_01", m0: "deck_01_e0", t0: "deck_01_e1" } } });
    const replaces = requests.filter((r) => r.replaceAllText || r.replaceAllShapesWithImage);
    expect(replaces.every((r) => (r.replaceAllText ?? r.replaceAllShapesWithImage).pageObjectIds.length === 1)).toBe(true);
    expect(replaces.filter((r) => r.replaceAllShapesWithImage).map((r) => r.replaceAllShapesWithImage.imageUrl)).toEqual(["https://signed/logo.png", "https://signed/start.png", "https://signed/mix.png"]);
    expect(replaces.find((r) => r.replaceAllShapesWithImage)).toMatchObject({ replaceAllShapesWithImage: { imageReplaceMethod: "CENTER_INSIDE", containsText: { text: "{{logo}}", matchCase: true } } });
    expect(required).toHaveLength(replaces.length);
    const moves = requests.filter((r) => r.updateSlidesPosition);
    expect(moves).toEqual(plan.slides.map((_, i) => ({ updateSlidesPosition: { slideObjectIds: [`deck_${String(i + 1).padStart(2, "0")}`], insertionIndex: i } })));
    expect(requests.slice(-9).map((r) => r.deleteObject.objectId)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
  });

  // Google's rules for the requests that place slides (Slides API reference,
  // DuplicateObjectRequest and UpdateSlidesPositionRequest): a copied slide
  // goes right after the slide it copies; a move lists its slides in their
  // current order with no duplicates, and its index counts the slides as they
  // were before the move. On 8 Nov 2026 one move of every slide broke the
  // second rule for Moburst, whose plan uses some template slides twice.
  function placeSlides(start: string[], requests: Array<Record<string, any>>): string[] {
    const order = [...start];
    for (const r of requests) {
      if (r.duplicateObject) {
        const from = order.indexOf(r.duplicateObject.objectId);
        order.splice(from + 1, 0, r.duplicateObject.objectIds[r.duplicateObject.objectId]);
      } else if (r.updateSlidesPosition) {
        const { slideObjectIds: moved, insertionIndex } = r.updateSlidesPosition;
        const at = moved.map((id: string) => order.indexOf(id));
        if (new Set(moved).size !== moved.length || at.some((x: number, k: number) => x < 0 || (k > 0 && x <= at[k - 1]))) {
          throw new Error("The slides should be in presentation order, with no duplicates.");
        }
        const before = at.filter((x: number) => x < insertionIndex).length;
        const rest = order.filter((id) => !moved.includes(id));
        rest.splice(insertionIndex - before, 0, ...moved);
        order.splice(0, order.length, ...rest);
      } else if (r.deleteObject) {
        order.splice(order.indexOf(r.deleteObject.objectId), 1);
      }
    }
    return order;
  }

  it("leaves the slides in the plan's order by Google's rules, when the plan uses a template slide more than once", () => {
    const plan = planDeck(input(3, 3), measure);
    expect(new Set(archetypesOf(plan.slides)).size).toBeLessThan(plan.slides.length);
    const { requests } = deckRequests(plan, findArchetypes(template), {});
    const ids = plan.slides.map((_, i) => `deck_${String(i + 1).padStart(2, "0")}`);
    expect(placeSlides(template.slides.map((s) => s.objectId), requests)).toEqual(ids);
  });

  it("finds a token a copy did not fill, so the copy goes to the trash", () => {
    const { requests, required } = deckRequests(planDeck(input(1, 2), measure), findArchetypes(template), {});
    const replies = requests.map((r) => (r.replaceAllText ? { replaceAllText: { occurrencesChanged: 1 } } : {}));
    expect(unfilled(required, replies)).toEqual([]);
    replies[required[3].index] = { replaceAllText: {} };
    expect(unfilled(required, replies)).toEqual([`slide ${required[3].slide + 1}: {{${required[3].token}}}`]);
  });

  it("stops when the template lacks a slide the plan needs", () => {
    expect(() => deckRequests({ slides: [{ archetype: "cards-9", text: {}, images: {} }], charts: {}, over: [] }, {}, {})).toThrow("cards-9");
  });

  it("sets every text run's weight by the face the .pptx names", () => {
    const reqs = weightRequests({ slides: [{ pageElements: [el("a", "Body"), { objectId: "b", shape: { text: { textElements: [{ startIndex: 0, endIndex: 5, textRun: { content: "Title", style: { fontFamily: "Geist" } } }, { endIndex: 6, paragraphMarker: {} }] } } }] }] });
    expect(reqs).toEqual([
      { updateTextStyle: { objectId: "a", textRange: { type: "FIXED_RANGE", startIndex: 0, endIndex: 4 }, style: { weightedFontFamily: { fontFamily: "Geist", weight: 300 } }, fields: "weightedFontFamily" } },
      { updateTextStyle: { objectId: "b", textRange: { type: "FIXED_RANGE", startIndex: 0, endIndex: 5 }, style: { weightedFontFamily: { fontFamily: "Geist", weight: 400 } }, fields: "weightedFontFamily" } },
    ]);
  });

  it("draws the template from the same geometry it is measured against", () => {
    const json = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets", "strategy-deck", "layout.json"), "utf8"));
    expect(json).toEqual(JSON.parse(JSON.stringify(DECK_LAYOUT)));
  });
});

describe("the template", () => {
  it("holds every archetype the plan can ask for, each with the tokens the plan fills", async () => {
    const { unzipSync, strFromU8 } = await import("fflate");
    const pptx = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets", "strategy-deck", "template.pptx"));
    const files = unzipSync(new Uint8Array(pptx));
    const slides = Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => strFromU8(files[f]).replace(/<[^>]+>/g, " "));
    const byName = new Map(slides.map((x) => [/\{\{a:([a-z0-9-]+)\}\}/.exec(x)?.[1] ?? "", x]));
    const want = ["cover-1", "cover-2", "divider", ...[1, 2, 3, 4, 5].flatMap((n) => [`cards-${n}`, `chart-cards-${n}`]), "start", "flow", "close"];
    expect([...byName.keys()].sort()).toEqual(want.sort());
    for (let n = 1; n <= 5; n++) {
      for (const name of [`cards-${n}`, `chart-cards-${n}`]) {
        const tokens = [...byName.get(name)!.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
        expect(tokens.sort(), name).toEqual(["title", "intro", ...(name.startsWith("chart") ? ["chart"] : []), ...Array.from({ length: n }, (_, i) => [`c${i + 1}_label`, `c${i + 1}_body`]).flat()].sort());
      }
    }
    // Every token a plan fills is on its archetype, so no copy is trashed for a template gap.
    const plan = planDeck(input(3, 6), measure);
    for (const s of plan.slides) {
      for (const token of [...Object.keys(s.text), ...Object.keys(s.images)]) expect(byName.get(s.archetype), `${s.archetype} {{${token}}}`).toContain(`{{${token}}}`);
    }
  });
});
