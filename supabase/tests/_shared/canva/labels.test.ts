import { ALIGNED } from "../../../functions/_shared/canva/brief";
import { describe, expect, it } from "vitest";
import {
  MAX_CANDIDATES, MAX_DESIGN_WORDS, MAX_HEADLINE_WORDS, MAX_LABELS, MAX_LABEL_WORDS, MAX_PLACING_WORDS,
  carouselPlannerPrompt, firstOnlyLabels, parseBriefs, parseCarouselBriefs, parseVideoBriefs, plannedVisualLine, plannerPrompt, recentLines, requestProgress, stillBriefs, withRefs,
  type Brief,
} from "../../../functions/_shared/canva/options";
import { designPrompt, type GenerateInput } from "../../../functions/_shared/canva/brief";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { type DesignRequest, type Settings, BUCKET, startOption } from "../../../functions/_shared/canva/jobs";

// Lettering beyond the headline (17 Nov 2026, "Yes, allow more"): the first
// option of a plan carries the labels its planned visual calls for, within
// fixed limits, with where they sit said apart from the picture. Every later
// option carries the headline only.

const reply = (...options: unknown[]) => JSON.stringify({ options });
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");
const hasLabels = (b: Brief) => !!b.labels?.length || !!b.slides?.some((s) => s.labels?.length);
const isPlain = (b: Brief) => !hasLabels(b) && !("placing" in b) && !b.slides?.some((s) => "placing" in s);

describe("the limits on a design's lettering", () => {
  it("are 6 labels of 8 words each, 45 words in all and 20 words of placing, with the headline's 12 unchanged", () => {
    expect([MAX_LABELS, MAX_LABEL_WORDS, MAX_DESIGN_WORDS, MAX_PLACING_WORDS, MAX_HEADLINE_WORDS]).toEqual([6, 8, 45, 20, 12]);
  });

  const one = (labels: unknown, headline: string[] = ["Four signs"], placing: unknown = "stacked under the headline") =>
    parseBriefs(reply({ headline, labels, placing, picture: "a clean steel bench" }), [], { labels: true })[0];
  const plain = (headline: string[] = ["Four signs"]) => ({ headline, picture: "a clean steel bench" });

  it("keep an option's labels at each limit", () => {
    expect(one(Array.from({ length: 6 }, (_, i) => `sign ${i + 1}`)).labels).toHaveLength(6);
    expect(one([words(8)]).labels).toEqual([words(8)]);
    // 5 headline words and 40 label words: 45.
    expect(one(Array.from({ length: 5 }, () => words(8)), [words(5)]).labels).toHaveLength(5);
  });

  it("never drop an option over a limit: its labels and placing are taken off and it stays, headline only", () => {
    expect(one(Array.from({ length: 7 }, (_, i) => `sign ${i + 1}`))).toEqual(plain());
    expect(one([words(9)])).toEqual(plain());
    // 6 headline words and 40 label words: 46.
    expect(one(Array.from({ length: 5 }, () => words(8)), [words(6)])).toEqual(plain([words(6)]));
    expect(one([{ text: "a label that is no text" }])).toEqual(plain());
    expect(one("Fair quotes")).toEqual(plain());
  });

  it("keep a label to its words and numbers: a pictograph is left out, and a piece with no word or number is no label", () => {
    expect(one(["Fair quotes \u{1F499}", "\u{1F447}", "  Clean   bays ", "→", "45%"]).labels).toEqual(["Fair quotes", "Clean bays", "45%"]);
    expect(one(["\u{1F447}", "•"])).toEqual(plain());
  });

  it("keep a placing of 20 words, and leave a longer one out while the labels stay", () => {
    expect(one(["Fair quotes"], ["Four signs"], `  ${words(20)}. `)).toEqual({ headline: ["Four signs"], labels: ["Fair quotes"], placing: words(20), picture: "a clean steel bench" });
    expect(one(["Fair quotes"], ["Four signs"], words(21))).toEqual({ headline: ["Four signs"], labels: ["Fair quotes"], picture: "a clean steel bench" });
    expect(one(["Fair quotes"], ["Four signs"], 7)).toEqual({ headline: ["Four signs"], labels: ["Fair quotes"], picture: "a clean steel bench" });
  });

  it("keep no placing without labels", () => {
    expect(one(undefined)).toEqual(plain());
    expect(one([])).toEqual(plain());
  });
});

describe("a post with no planned visual", () => {
  const text = reply({ headline: ["Four signs"], labels: ["Fair quotes", "Clean bays"], placing: "stacked", picture: "a clean steel bench" }, { headline: ["Plain"], picture: "a bench" });
  const today = [{ headline: ["Four signs"], picture: "a clean steel bench" }, { headline: ["Plain"], picture: "a bench" }];

  it("has no labels and no placing, whatever the planner replied: its briefs are today's", () => {
    expect(parseBriefs(text)).toEqual(today);
    expect(parseBriefs(text, [], {})).toEqual(today);
    expect(parseBriefs(text, [], { labels: false })).toEqual(today);
    for (const visual of [undefined, null, "", "   "]) expect(stillBriefs(text, { carousel: false, library: [], visual })).toEqual(today);
  });

  it("is planned without any word of labels or placing", () => {
    const base = { brand: "Northwind", platform: "Instagram", copy: "Four signs you picked the right shop.", voice: null, count: 3, postCount: 6, recent: "" };
    for (const p of [plannerPrompt(base), plannerPrompt({ ...base, story: true }), carouselPlannerPrompt({ ...base, slides: 5 })]) {
      expect(p).not.toMatch(/label|placing/i);
      expect(p).toContain("The picture itself holds no lettering, numbers, signs, screens with writing, logos or brand marks, and names no brand: the headline is the only lettering on the design.");
    }
    expect(parseVideoBriefs(reply({ headline: ["Hook"], labels: ["A"], text: "bold white type, lower third", footage: "a slow push in on a bench at dawn" }))[0].labels).toBeUndefined();
  });
});

describe("a post whose planned visual calls for lettering", () => {
  const base = { brand: "Northwind", platform: "Instagram", copy: "Four signs you picked the right shop.", voice: null, count: 3, postCount: 6, recent: "" };
  const visual = "The four signs stacked beside white hearts on a soft green background.";

  it("asks the planner for labels on the first option only, when the planned visual calls for them, as words and numbers within the limits", () => {
    const line = "labels: only on the first option, and only when the planned visual calls for lettering beyond the headline (list items, labels, numbers): those pieces in the planned visual's own words, one label for each piece. Words and numbers only: no symbols and no emoji. At most 6 labels, each of at most 8 words, and at most 45 words on the design with the headline; when the planned visual calls for more, give the pieces that carry its point within these limits. Leave labels out when the planned visual calls for no lettering beyond the headline.";
    expect(plannerPrompt({ ...base, visual }).split("\n")).toContain(`- ${line}`);
    expect(plannerPrompt({ ...base, story: true, visual }).split("\n")).toContain(`- ${line}`);
    // A carousel's labels are each slide's own.
    expect(carouselPlannerPrompt({ ...base, slides: 5, visual }).split("\n")).toContain(`  - ${line}`);
  });

  it("asks where the labels sit apart from the picture, in 20 words at most", () => {
    const line = 'placing: only with labels: where the labels sit, in at most 20 words, for example "stacked under the headline" or "one in each square".';
    expect(plannerPrompt({ ...base, visual }).split("\n")).toContain(`- ${line}`);
    expect(carouselPlannerPrompt({ ...base, slides: 5, visual }).split("\n")).toContain(`  - ${line}`);
  });

  it("keeps the picture the scene alone: no lettering in it and no word about the labels", () => {
    for (const p of [plannerPrompt({ ...base, visual }), carouselPlannerPrompt({ ...base, slides: 5, visual })]) {
      expect(p).toContain("The picture itself holds no lettering, numbers, signs, screens with writing, logos or brand marks, and names no brand: the headline and the labels are the only words on the design, and the picture says nothing of them.");
      expect(p).not.toContain("where each label sits");
    }
  });

  it("gives the plan's lettering to the first option's labels, quoted or not, and the plan's colors to the design", () => {
    const line = plannedVisualLine("Northwind", visual);
    expect(line).toContain("Where it calls for lettering beyond the headline (list items, labels, numbers), those pieces are the first option's labels, in the planned visual's own words; words it gives as a label or a list item are labels also when they are in quotation marks, never the headline.");
    expect(line).not.toContain("without lettering");
    expect(line).toContain("the headline is those words exactly");
    expect(line).toContain("The picture is its subject and setting, in the look of Northwind's posts. Where it names colors, the design uses those colors; otherwise Northwind's own.");
    expect(line).not.toContain("setting and colors");
  });

  it("says only the first option may carry labels, so a design always arrives", () => {
    expect(plannerPrompt({ ...base, visual }).split("\n")).toContain("Only the first option may carry labels. Every later option carries the headline only, with no labels and no placing, so a design is made even when the labels cannot be set.");
    expect(carouselPlannerPrompt({ ...base, slides: 5, visual }).split("\n")).toContain("Only the first option may carry labels, each slide its own. Every later option carries each slide's headline only, with no labels and no placing, so a design is made even when the labels cannot be set.");
  });

  it("shows the reply's shape with labels and placing on the first option and none on the next", () => {
    expect(plannerPrompt({ ...base, visual }).split("\n").at(-1)).toBe('Reply with JSON only: {"options":[{"posts":[2,5],"layout":"...","headline":["line one","optional line two"],"labels":["...","..."],"placing":"...","picture":"..."},{"posts":[4,7],"layout":"...","headline":["line one","optional line two"],"picture":"..."}]}');
    expect(carouselPlannerPrompt({ ...base, slides: 5, visual }).split("\n").at(-1)).toBe('Reply with JSON only: {"options":[{"posts":[2,5],"layout":"...","slides":[{"headline":["line one","optional line two"],"labels":["...","..."],"placing":"...","picture":"..."}]},{"posts":[4,7],"layout":"...","slides":[{"headline":["line one","optional line two"],"picture":"..."}]}]}');
  });
});

describe("only the first option of a plan carries labels", () => {
  const labeled = (n: number): Brief => ({ headline: [`Signs ${n}`], labels: ["Fair quotes", "Clean bays"], placing: "stacked under the headline", picture: `bench ${n}`, refs: ["a.jpg"], layout: "list" });
  const plain = (n: number): Brief => ({ headline: [`Plain ${n}`], picture: `yard ${n}` });
  const stripped = (b: Brief): Brief => { const { labels: _labels, placing: _placing, ...rest } = b; return rest; };

  it("leaves a plan without labels exactly as it is", () => {
    for (const briefs of [[plain(1)], [plain(1), plain(2), plain(3)], [plain(1), plain(2), plain(3), plain(4)], []]) expect(firstOnlyLabels(briefs)).toBe(briefs);
  });

  it("takes labels and placing off every later option, whatever the planner replied", () => {
    expect(firstOnlyLabels([labeled(1), labeled(2), labeled(3)])).toEqual([labeled(1), stripped(labeled(2)), stripped(labeled(3))]);
    expect(firstOnlyLabels([labeled(1), plain(2), labeled(3), labeled(4)])).toEqual([labeled(1), plain(2), stripped(labeled(3)), stripped(labeled(4))]);
    expect(firstOnlyLabels([plain(1), labeled(2), labeled(3)])).toEqual([plain(1), stripped(labeled(2)), stripped(labeled(3))]);
  });

  it("fills a short plan with plain copies of its own options, so the labeled one is started once", () => {
    expect(firstOnlyLabels([labeled(1)])).toEqual([labeled(1), stripped(labeled(1)), stripped(labeled(1))]);
    expect(firstOnlyLabels([labeled(1), plain(2)])).toEqual([labeled(1), plain(2), stripped(labeled(1))]);
    // A short plan whose first option is plain goes round as it always has.
    expect(firstOnlyLabels([plain(1), labeled(2)])).toEqual([plain(1), stripped(labeled(2))]);
  });

  it("takes them off every slide of a later carousel option", () => {
    const slide = (n: number) => ({ headline: [`Point ${n}`], labels: [`Label ${n}`], placing: "top right", picture: `scene ${n}` });
    const carousel: Brief = { ...slide(1), slides: [slide(1), slide(2)] };
    const out = firstOnlyLabels([carousel, carousel, carousel]);
    expect(out[0]).toEqual(carousel);
    for (const later of [out[1], out[2]]) expect(later).toEqual({ headline: ["Point 1"], picture: "scene 1", slides: [{ headline: ["Point 1"], picture: "scene 1" }, { headline: ["Point 2"], picture: "scene 2" }] });
  });

  it("so a plan whose first option is labeled starts it once, and always ends with a plain option whose picture is plain", () => {
    const o = (n: number, labels = true) => ({ headline: [`Signs ${n}`], ...(labels ? { labels: ["Fair quotes", "Clean bays"], placing: "one in each square" } : {}), picture: `a clean steel bench ${n}` });
    const g = (b: Brief) => ({ brand_name: "Northwind", platform: "Instagram", concept: b.picture });
    for (const replied of [[o(1)], [o(1), o(2)], [o(1), o(2), o(3)], [o(1), o(2, false)], [o(1), o(2), o(3), o(4)], [o(1), o(2, false), o(3)]]) {
      const briefs = stillBriefs(reply(...replied), { carousel: false, library: [], visual: "four squares, each with a sign" });
      expect(hasLabels(briefs[0])).toBe(true);
      // The briefs a request starts, one after each option that failed (requestProgress), up to its limit.
      const failed = { status: "failed" as const, step: "failed" };
      const tried = Array.from({ length: MAX_CANDIDATES }, (_, n) => briefs[requestProgress(Array.from({ length: n }, () => failed), 1, briefs.length, MAX_CANDIDATES).start_brief!]);
      expect(tried.map(hasLabels), JSON.stringify(replied.length)).toEqual([true, false, false]);
      const last = tried[MAX_CANDIDATES - 1];
      expect(isPlain(last)).toBe(true);
      // The picture never spoke of the labels, so the plain design's instruction has no word of them.
      expect(last.picture).toMatch(/^a clean steel bench \d$/);
      expect(designPrompt(g(last), last.headline, 2, undefined, last.labels, last.placing)).not.toMatch(/label|square/i);
      expect(designPrompt(g(last), last.headline, 2, undefined, last.labels, last.placing)).toBe(designPrompt(g(last), last.headline, 2));
    }
  });

  it("is held by the parsers, a carousel's too, with labels each slide's own", () => {
    const slide = (n: number) => ({ headline: [`Point ${n}`], labels: [`Label ${n}`], placing: "top right", picture: `scene ${n}` });
    const carousels = parseCarouselBriefs(reply({ slides: [slide(1), slide(2)] }, { slides: [slide(1), slide(2)] }), 2, [], { labels: true });
    expect(carousels.map(hasLabels)).toEqual([true, false, false]);
    expect(carousels[0].slides).toEqual([slide(1), slide(2)]);
    expect(carousels.slice(1).every(isPlain)).toBe(true);
  });

  it("keeps a carousel option with a slide over a limit, without any labels", () => {
    const slide = (n: number, labels: string[]) => ({ headline: [`Point ${n}`], labels, placing: "top right", picture: `scene ${n}` });
    const over = Array.from({ length: 7 }, (_, i) => `sign ${i}`);
    expect(parseCarouselBriefs(reply({ slides: [slide(1, ["Fine"]), slide(2, over)] }), 2, [], { labels: true })).toEqual([
      { headline: ["Point 1"], picture: "scene 1", slides: [{ headline: ["Point 1"], picture: "scene 1" }, { headline: ["Point 2"], picture: "scene 2" }] },
    ]);
  });
});

describe("an option the planner named no posts for", () => {
  const library = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"];
  it("builds on the posts the same reply chose for its other options", () => {
    const briefs = withRefs([
      { headline: ["one"], picture: "p1" },
      { headline: ["two"], picture: "p2", refs: ["c.jpg"] },
      { headline: ["three"], picture: "p3", refs: ["d.jpg", "c.jpg"] },
      { headline: ["four"], picture: "p4" },
    ], library, []);
    expect(briefs.map((b) => b.refs)).toEqual([["c.jpg", "d.jpg"], ["c.jpg"], ["d.jpg", "c.jpg"], ["c.jpg", "d.jpg"]]);
  });
  it("falls back to the least recently used posts only when the reply chose none at all", () => {
    const briefs = withRefs([{ headline: ["one"], picture: "p1" }, { headline: ["two"], picture: "p2" }], library, [{ refs: ["a.jpg"], layout: null, picture: "newest" }]);
    expect(briefs.map((b) => b.refs)).toEqual([["b.jpg", "c.jpg"], ["d.jpg", "a.jpg"]]);
  });
});

describe("the image model and a design's labels", () => {
  const g = { brand_name: "Northwind", platform: "Instagram", concept: "a clean steel bench" };
  const labels = ["Fair quotes", "Clean bays"];
  const set = 'Labels, each set once and spelled exactly: "Fair quotes"; "Clean bays".';
  const placed = `${set} Where the labels sit: one in each square.`;

  it("is told to set the headline and each label exactly, where the placing says, and nothing else", () => {
    const prompts = {
      post: designPrompt(g, ["Four signs.", "One shop."], 2, undefined, labels, "one in each square"),
      slide: designPrompt(g, ["Four signs.", "One shop."], 2, { index: 1, count: 5, withCover: true }, labels, "one in each square"),
      story: designPrompt({ ...g, surface: "story" }, ["Four signs.", "One shop."], 2, undefined, labels, "one in each square"),
    };
    for (const [kind, p] of Object.entries(prompts)) {
      expect(p, kind).toContain(`Headline, spelled exactly: "Four signs." Second line, spelled exactly: "One shop." ${placed}`);
      expect(p.indexOf("Add no other text"), kind).toBeGreaterThan(p.indexOf(placed));
    }
    expect(prompts.post).toContain(`${placed} ${ALIGNED} Add no other text and no other logo.`);
    // A Story's labels sit in the band with its headline.
    expect(prompts.story).toContain(`${placed} ${ALIGNED} Every word sits inside the band`);
    // A slide's labels may be numbers: only other slide numbers are kept out.
    expect(prompts.slide).toContain(`${placed} ${ALIGNED} Add no other text, no slide numbers other than the labels given and no other logo.`);
  });

  it("sets the labels without a placing when the plan gave none", () => {
    for (const none of [undefined, null, "", "  "]) expect(designPrompt(g, ["Four signs."], 2, undefined, labels, none)).toContain(`${set} ${ALIGNED} Add no other text and no other logo.`);
  });

  it("gets today's prompt for a design without labels, and never a placing on its own", () => {
    for (const none of [undefined, null, []]) {
      expect(designPrompt(g, ["Four signs."], 2, undefined, none as never, "one in each square")).toBe(designPrompt(g, ["Four signs."], 2));
      expect(designPrompt(g, ["Four signs."], 2, { index: 0, count: 5, withCover: false }, none as never, "one in each square")).toBe(designPrompt(g, ["Four signs."], 2, { index: 0, count: 5, withCover: false }));
    }
    expect(designPrompt(g, ["Four signs."], 2)).not.toMatch(/label|square/i);
    expect(designPrompt(g, ["Four signs."], 2, { index: 1, count: 5, withCover: true })).toContain("Add no other text, no slide numbers and no other logo.");
  });
});

describe("a job and its labels", () => {
  /** A PNG's first 24 bytes: its signature and its IHDR width and height. */
  function pngHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const v = new DataView(bytes.buffer);
    v.setUint32(16, width);
    v.setUint32(20, height);
    return bytes;
  }
  const settings: Settings = {
    client_id: "c1", logo_path: "c1/logo.png", placement: { anchor: "center", width: 0.323, top: 0.048 }, background: "#0B0E1A", reference_paths: ["c1/a.jpg", "c1/b.jpg", "c1/c.jpg"],
    derived: { logo_checked: "c1/logo.png" },
  };
  const request = (over: Partial<DesignRequest>): DesignRequest => ({
    id: "req-1", client_id: "c1", report_id: null, calendar_post_key: "post:1", platform: "Instagram", format: "Single image", post_copy: "Four signs.",
    requested_by: "person-1", status: "preparing", kind: "single", options_wanted: 1, candidates_started: 0, briefs: [], ...over,
  });
  const jobsOf = async (req: DesignRequest, briefIndex = 0) => {
    const db = fakeDb({ canva_finish_jobs: [] });
    db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
    await startOption(db, req, settings, "Northwind", briefIndex, briefIndex);
    return db.tables.canva_finish_jobs;
  };

  it("carries the headline as its copy, with the labels and their placing beside it", async () => {
    const [job] = await jobsOf(request({ briefs: [{ headline: ["Four signs."], labels: ["Fair quotes", "Clean bays"], placing: "one in each square", picture: "a clean steel bench", refs: ["c1/b.jpg"] }] }));
    expect(job.input.copy).toEqual(["Four signs."]);
    expect(job.input.labels).toEqual(["Fair quotes", "Clean bays"]);
    expect(job.input.placing).toBe("one in each square");
    expect(job.input.generate.concept).toBe("a clean steel bench");
  });

  it("has no labels or placing key for a brief without labels, as every job before had none", async () => {
    for (const brief of [
      { headline: ["Four signs."], picture: "a bench", refs: ["c1/b.jpg"] },
      { headline: ["Four signs."], labels: [], picture: "a bench", refs: ["c1/b.jpg"] },
      { headline: ["Four signs."], placing: "one in each square", picture: "a bench", refs: ["c1/b.jpg"] },
    ]) {
      const [job] = await jobsOf(request({ briefs: [brief] }));
      expect("labels" in job.input).toBe(false);
      expect("placing" in job.input).toBe(false);
    }
  });

  it("gives each slide of a carousel its own labels", async () => {
    const slides = [{ headline: ["Cover"], picture: "p1" }, { headline: ["Point"], labels: ["November winner", "January rerun"], placing: "one over each half", picture: "a split mockup" }];
    const jobs = await jobsOf(request({ kind: "carousel", briefs: [{ ...slides[0], slides, refs: ["c1/b.jpg"] }] }));
    expect(jobs.map((j) => j.input.labels)).toEqual([undefined, ["November winner", "January rerun"]]);
    expect(jobs.map((j) => j.input.placing)).toEqual([undefined, "one over each half"]);
    expect(jobs.map((j) => j.input.copy)).toEqual([["Cover"], ["Point"]]);
  });

  // The whole way: the planner's reply, read the way design-request reads it
  // (stillBriefs, labels decided by the post's planned visual), kept on the
  // request, started as jobs (jobs.ts), and drawn from the job's input.
  it("takes the planner's labels from its reply to the job's input and the image model's instruction", async () => {
    const text = reply(
      { posts: [2], layout: "list", headline: ["Four signs.", "One shop."], labels: ["Fair quotes", "Clean bays"], placing: "one in each square", picture: "a clean steel bench" },
      { posts: [3], layout: "statement", headline: ["Four signs."], labels: ["Fair quotes"], placing: "under the headline", picture: "a yard at dawn" },
    );
    const library = ["c1/a.jpg", "c1/b.jpg", "c1/c.jpg"];
    const briefs = withRefs(stillBriefs(text, { carousel: false, library, visual: "four squares, each with a sign" }), library, []);
    const [first] = await jobsOf(request({ briefs }), 0);
    expect(first.input).toMatchObject({ copy: ["Four signs.", "One shop."], labels: ["Fair quotes", "Clean bays"], placing: "one in each square" });
    expect(first.input.generate).toMatchObject({ concept: "a clean steel bench", refs: ["c1/b.jpg"] });
    const prompt = designPrompt(first.input.generate as GenerateInput, first.input.copy, first.input.generate.refs.length, undefined, first.input.labels, first.input.placing);
    expect(prompt).toContain('Labels, each set once and spelled exactly: "Fair quotes"; "Clean bays". Where the labels sit: one in each square.');
    // The replacement options are plain, whatever the planner put on them.
    for (const index of [1, 2]) {
      const [later] = await jobsOf(request({ briefs }), index);
      expect("labels" in later.input, String(index)).toBe(false);
      expect("placing" in later.input, String(index)).toBe(false);
    }
    // The same reply for a post with no planned visual: no job has labels.
    const none = withRefs(stillBriefs(text, { carousel: false, library, visual: null }), library, []);
    const [job] = await jobsOf(request({ briefs: none }), 0);
    expect("labels" in job.input).toBe(false);
    expect("placing" in job.input).toBe(false);
  });

  it("still tells the planner what a recent design showed, labels or none", () => {
    expect(recentLines([{ refs: ["a.jpg"], layout: "list", picture: "a clean steel bench" }], ["a.jpg"])).toContain("- built on Post 1, list: a clean steel bench");
  });
});
