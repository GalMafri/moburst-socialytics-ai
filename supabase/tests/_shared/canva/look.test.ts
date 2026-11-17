import { describe, expect, it } from "vitest";
import { carouselPlannerPrompt, plannerPrompt, videoPlannerPrompt } from "../../../functions/_shared/canva/options";
import { designPrompt } from "../../../functions/_shared/canva/brief";

// The client's posts set the look only (17 Nov 2026): colors, type treatment
// and layout style. The scene is new each time. An option is built on the
// look most of the posts share; a one-off look only for a post about the
// subject that one-off was made for.

const base = { brand: "Northwind", platform: "Instagram", copy: "Four signs you picked the right shop.", voice: null, count: 3, postCount: 16, recent: "" };
const visual = "The four signs stacked beside white hearts on a soft green background.";
const colors = "What the app holds about Northwind's colors: its brand colors are #0B1F3A and #D62828. Use them to tell the shared look from a one-off: when most of the posts are in these colors, a post whose grounds, bands and type are in none of them is a one-off.";

const stills = (over: Record<string, unknown> = {}) => ({
  single: plannerPrompt({ ...base, ...over }),
  story: plannerPrompt({ ...base, story: true, ...over }),
  carousel: carouselPlannerPrompt({ ...base, slides: 5, ...over }),
});

describe("the planner and the client's look", () => {
  const rule = "Northwind's posts set the look of a new design and nothing else: the colors, the type treatment and the layout style. Layout style is how type and picture are arranged (where the headline sits, panels, margins), never the picture's own scene. Every option is built on the look most of the posts share. A post that looks unlike most of the others (other colors, other lettering, a themed or seasonal treatment) is a one-off: an option is built on a one-off only when this new post is about the same subject that one-off was made for. The scene is new every time: no option reproduces a person, a place, the props or the composition of a past post. Northwind's own product, packaging or app, as its posts show it, may appear when this post is about it.";

  it("is told which look to build on, when a one-off may be chosen and that the scene is new, before the post is described", () => {
    for (const [kind, p] of Object.entries({ ...stills(), ...stills({ visual }) })) {
      const lines = p.split("\n");
      expect(lines.filter((l) => l === rule), kind).toHaveLength(1);
      expect(lines.indexOf(rule), kind).toBe(1);
      expect(p.indexOf(rule), kind).toBeLessThan(p.indexOf('"""Four signs you picked the right shop."""'));
    }
  });

  it("is given the colors the app holds, right after the rule, and nothing when it holds none", () => {
    for (const [kind, p] of Object.entries(stills({ colors }))) {
      const lines = p.split("\n");
      expect(lines[lines.indexOf(rule) + 1], kind).toBe(colors);
    }
    for (const p of Object.values(stills())) expect(p).not.toContain("What the app holds");
    for (const p of Object.values(stills({ colors: "" }))) expect(p).not.toContain("What the app holds");
  });

  it("chooses two posts of the shared look with different scenes, for the look and never the picture", () => {
    const line = "- posts: the numbers of two of Northwind's posts that carry the shared look and show different scenes from each other, with a layout that suits what this post says (a quote suits a quote layout, a comparison or list a comparison or list layout, a product or feature a product layout, a statement a statement layout); one post when no second one fits. They give the colors, the type treatment and the layout style, never the picture. A one-off is chosen only when this post is about the subject it was made for. When the recent designs were built on a post and another suits the content as well, choose the other.";
    for (const [kind, p] of Object.entries({ ...stills(), ...stills({ visual }) })) {
      expect(p.split("\n"), kind).toContain(line);
      expect(p.split("\n"), kind).toContain("- layout: a few words naming the layout of the posts you chose.");
    }
  });

  it("writes a new scene for the post's message, never a past post's person, place, props or composition", () => {
    const lead = "picture: one sentence describing the picture behind the words: a new scene made for this post's message, in the picture style of Northwind's posts (photograph, illustration or render, with their light and colors), with a subject the recent designs did not show. It never reproduces a person, a place, the props or the composition of a past post.";
    for (const [kind, p] of Object.entries(stills())) {
      expect(p, kind).toContain(lead);
      expect(p, kind).not.toContain("using the kinds of subjects");
      expect(p, kind).not.toContain("composition of the posts you chose");
    }
  });

  it("writes the planned visual as a new scene too", () => {
    const lead = "picture: one sentence describing the picture behind the words: the planned visual's subject and setting, as a new scene in the picture style of Northwind's posts (photograph, illustration or render, with their light and colors). It never reproduces a person, a place, the props or the composition of a past post.";
    for (const [kind, p] of Object.entries(stills({ visual }))) {
      expect(p, kind).toContain(lead);
      expect(p, kind).not.toContain("materials, light and composition of the posts you chose");
    }
  });

  it("lets the client's own product appear when the post is about it, said once", () => {
    for (const [kind, p] of Object.entries({ ...stills(), ...stills({ visual }) })) {
      expect(p.split("own product, packaging or app").length - 1, kind).toBe(1);
      expect(p.split("Layout style is how type and picture are arranged").length - 1, kind).toBe(1);
    }
  });

  it("keeps every rule the picture had: sharp focus, no lettering, no brand, no real person", () => {
    for (const [kind, p] of Object.entries({ ...stills(), ...stills({ visual }) })) {
      expect(p, kind).toContain("Describe what is in the picture, all of it in sharp focus.");
      expect(p, kind).toContain("The picture itself holds no lettering, numbers, signs, screens with writing, logos or brand marks, and names no brand: ");
      // No real person, whatever the picture is: the rule no longer hangs on a chosen post having one.
      expect(p, kind).toContain("It shows no real or identifiable person and no portrait standing in for one: where the picture would show a real person, use an object, a scene or hands instead.");
      expect(p, kind).not.toContain("where a chosen post has a person");
      expect(p, kind).toContain("One line of at most 8 words, optionally a second, shorter line. Words only: an emoji stays in the post's copy.");
    }
    expect(stills().carousel).toContain("The slides of one option share one setting and look, so they read as a series, and each slide shows a different subject or moment, so no two slides repeat a picture.");
  });

  it("shows two posts in the reply's shape", () => {
    expect(stills().single.split("\n").at(-1)).toBe('Reply with JSON only: {"options":[{"posts":[2,5],"layout":"...","headline":["line one","optional line two"],"picture":"..."}]}');
    expect(stills().carousel.split("\n").at(-1)).toBe('Reply with JSON only: {"options":[{"posts":[2,5],"layout":"...","slides":[{"headline":["line one","optional line two"],"picture":"..."}]}]}');
  });

  it("leaves a video's planner as it was", () => {
    for (const p of [videoPlannerPrompt(base), videoPlannerPrompt({ ...base, filmed: "its founder" })]) {
      expect(p).toContain("- posts: the numbers of one or two of Northwind's posts whose layout suits what this post says");
      expect(p).not.toContain("shared look");
    }
  });
});

describe("the image model and the client's look", () => {
  const g = { brand_name: "Northwind", platform: "Instagram", concept: "a torque wrench on a clean steel bench" };
  const look = (those: string, their: string, show: string) => `Take ${those} look and nothing else: ${their} colors, ${their} type treatment and ${their} layout style, which is how type and picture are arranged (where the headline sits, panels, margins), never the picture's own scene. The scene is a new one, drawn for this design: do not reproduce a person, a place, the props or the composition ${show}. Northwind's own product, packaging or app may appear as ${show} it, when the picture calls for it.`;
  const two = look("those posts'", "their", "those posts show");
  const one = look("that post's", "its", "that post shows");

  const prompts = (refCount: number) => ({
    post: designPrompt(g, ["Four signs."], refCount),
    story: designPrompt({ ...g, surface: "story" }, ["Four signs."], refCount),
    cover: designPrompt(g, ["Four signs."], refCount, { index: 0, count: 5, withCover: false }),
    slide: designPrompt(g, ["Four signs."], refCount, { index: 2, count: 5, withCover: true }),
    card: designPrompt({ ...g, video_card: "cover" }, ["Four signs."], refCount),
    endCard: designPrompt({ ...g, video_card: "end" }, ["Four signs."], refCount, { index: 1, count: 2, withCover: true }),
  });

  it("takes the look from the client's posts and draws the planned picture, on every kind of design", () => {
    for (const [kind, p] of Object.entries(prompts(2))) {
      expect(p.split(two).length - 1, kind).toBe(1);
      expect(p, kind).toContain(`Northwind's own posts${kind === "story" ? ", the picture filling the tall frame from edge to edge" : kind === "card" || kind === "endCard" ? ", filling the tall frame" : ""}. ${two} The picture shows a torque wrench on a clean steel bench.`);
      expect(p, kind).toContain("in the look of");
      expect(p, kind).not.toContain("visual language");
    }
  });

  it("says it of one post when the design builds on one", () => {
    for (const [kind, p] of Object.entries(prompts(1))) {
      expect(p.split(one).length - 1, kind).toBe(1);
      expect(p, kind).not.toContain("those posts");
    }
  });

  it("is, for a post, this instruction to the letter", () => {
    expect(designPrompt(g, ["Four signs.", "One shop."], 2)).toBe(
      "The first image is the canvas for a new Northwind Instagram post (4:5). Its logo is final: keep it exactly as it is, where it is. " +
      "Design the whole post around it in the look of the other two images, which are Northwind's own posts. " +
      "Take those posts' look and nothing else: their colors, their type treatment and their layout style, which is how type and picture are arranged (where the headline sits, panels, margins), never the picture's own scene. " +
      "The scene is a new one, drawn for this design: do not reproduce a person, a place, the props or the composition those posts show. Northwind's own product, packaging or app may appear as those posts show it, when the picture calls for it. " +
      "The picture shows a torque wrench on a clean steel bench. " +
      'Headline, spelled exactly: "Four signs." Second line, spelled exactly: "One shop." Add no other text and no other logo. ' +
      "Every part of the picture is in sharp focus, with no blurred or out-of-focus objects.",
    );
  });

  it("keeps every rule it had: the logo final, the exact words, no other text or logo, sharp focus, a slide's own picture", () => {
    for (const [kind, p] of Object.entries(prompts(2))) {
      expect(p, kind).toContain("Its logo is final: keep it exactly as it is, where it is.");
      expect(p, kind).toContain('Headline, spelled exactly: "Four signs."');
      expect(p, kind).toMatch(/Add no other text(, no slide numbers)? and no other logo\./);
      expect(p, kind).toContain("Every part of the picture is in sharp focus, with no blurred or out-of-focus objects.");
    }
    expect(prompts(2).slide).toContain("The second image is slide 1 of this same carousel: keep its background, palette, type and where the words sit so the slides read as one series. Its picture is not repeated: this slide has a picture of its own.");
    expect(prompts(2).slide).toContain("Add no other text, no slide numbers and no other logo.");
    expect(prompts(2).story).toContain("Every word sits inside the band that leaves out the top 14%, the bottom 35% and 6% at each side of the frame.");
    expect(prompts(2).endCard).toContain("The second image is this video's opening card: keep its background, palette, type and layout so the two cards read as a pair.");
  });
});
