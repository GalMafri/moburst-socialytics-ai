// Social AI sync, 18 Nov 2026 (Sinéad): an uploaded brand book should win over
// the scraped posts when a brand has changed its look (Bader Law's rebrand),
// and the client's strategy should be a lasting reference for designs. The
// planner saw neither: only the posts and the brand's tone of voice.
import { describe, expect, it } from "vitest";
import { brandBookRules, brandGuideLines } from "../../../functions/_shared/design/brandGuide";
import { carouselPlannerPrompt, plannerPrompt, videoPlannerPrompt } from "../../../functions/_shared/canva/options";
import { designStrategyBlock } from "../../../functions/_shared/strategy/prompt";

const IDENTITY = {
  primary_color: "#0B2545", secondary_color: "#C9A227", accent_color: "gold", font_family: "Playfair Display",
  visual_style: "Calm, editorial, lots of navy space", design_elements: "Thin gold rules", background_style: "Solid navy", tone_of_voice: "Plain and warm",
};

describe("the brand book's rules", () => {
  it("are read from the brand identity while a brand book is on file", () => {
    const rules = brandBookRules(IDENTITY, "c1/book.pdf");
    expect(rules).toContain("- Colours: primary #0B2545, secondary #C9A227");
    expect(rules).not.toContain("gold,");
    expect(rules).toContain("- Visual style: Calm, editorial, lots of navy space");
    expect(rules).toContain("- Typeface: Playfair Display");
    expect(rules).not.toContain("Plain and warm");
  });

  it("are empty without a brand book, when the identity came from research or a guess", () => {
    expect(brandBookRules(IDENTITY, null)).toBe("");
    expect(brandBookRules(null, "c1/book.pdf")).toBe("");
  });
});

describe("the planner's guide", () => {
  it("lets the brand book win over the posts and asks every option to serve the strategy", () => {
    const guide = brandGuideLines("Bader Law", { brandBook: "- Colours: primary #0B2545", strategy: "The client's content strategy, as the team keeps it:\nAudience:\nInjured workers in Texas" });
    expect(guide).toContain("Bader Law's brand book:\n- Colours: primary #0B2545");
    expect(guide).toContain("follow the brand book");
    expect(guide).toContain("Injured workers in Texas");
    expect(guide).toContain("Every option serves this strategy");
  });

  it("is empty when there is neither, so plans read as they did", () => {
    expect(brandGuideLines("X", { brandBook: "", strategy: null })).toBe("");
  });

  it("reaches the still, carousel and video planners", () => {
    const base = { brand: "Bader Law", platform: "Instagram", copy: "Hurt at work?", voice: null, count: 3, postCount: 4, recent: "", guide: "GUIDE LINE" };
    expect(plannerPrompt(base)).toContain("GUIDE LINE");
    expect(carouselPlannerPrompt({ ...base, slides: 4 })).toContain("GUIDE LINE");
    expect(videoPlannerPrompt(base)).toContain("GUIDE LINE");
    expect(videoPlannerPrompt({ ...base, filmed: "the speaker" })).toContain("GUIDE LINE");
    expect(plannerPrompt({ ...base, guide: undefined })).not.toContain("undefined");
  });
});

// deno-lint-ignore no-explicit-any
function db(strategy: any, edits: any[] = [], fail = false) {
  return {
    from: (table: string) => {
      // deno-lint-ignore no-explicit-any
      const q: any = { select: () => q, eq: () => q, in: () => q };
      if (table === "content_strategies") q.maybeSingle = async () => (fail ? { data: null, error: { message: "down" } } : { data: strategy, error: null });
      else q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: edits, error: null }).then(ok);
      return q;
    },
  };
}

describe("the strategy a design is planned against", () => {
  const strategy = { written_at: "2026-11-10T00:00:00Z", sections: {
    goals: { items: [{ title: "Grow followers" }] },
    audience: { who: "Injured workers in Texas", wants: [], where: [] },
    positioning: { statement: "The firm that answers the phone", points: [] },
    avoid: { items: [{ pattern: "Stock photos of gavels", source: "team" }] },
  } };

  it("is the audience, positioning and what to avoid, with the team's own version", async () => {
    const block = await designStrategyBlock(db(strategy, [{ section_key: "audience", text: "Injured workers and their families", value: null }]), "c1");
    expect(block).toContain("Injured workers and their families");
    expect(block).toContain("The firm that answers the phone");
    expect(block).toContain("Stock photos of gavels");
    expect(block).not.toContain("Grow followers");
  });

  it("is empty when there is no strategy, or it cannot be read, so the design goes on", async () => {
    expect(await designStrategyBlock(db(null), "c1")).toBe("");
    expect(await designStrategyBlock(db({ written_at: null, sections: strategy.sections }), "c1")).toBe("");
    expect(await designStrategyBlock(db(strategy, [], true), "c1")).toBe("");
    expect(await designStrategyBlock(db({ written_at: "2026-11-10", sections: { goals: strategy.sections.goals } }), "c1")).toBe("");
  });
});
