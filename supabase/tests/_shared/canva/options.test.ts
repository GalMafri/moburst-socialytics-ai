import { describe, it, expect } from "vitest";
import { MAX_CANDIDATES, VIDEO_CANDIDATES, candidatesFor, carouselPlannerPrompt, parseBriefs, plannerPrompt, requestProgress, videoPlannerPrompt, type JobState } from "../../../functions/_shared/canva/options";

const done: JobState = { status: "done", step: "finished" };
const failed: JobState = { status: "failed", step: "edit" };
const designing: JobState = { status: "running", step: "generate" };
const finishing: JobState = { status: "running", step: "export_final_wait" };

describe("parseBriefs", () => {
  it("keeps well-formed briefs and drops the rest", () => {
    const text = 'Here you go {"options":[{"headline":["AI answers are changing","how brands get found"],"picture":"a crystal brain on a glass pedestal"},{"headline":[],"picture":"x"},{"headline":["one two three four five six seven eight nine ten eleven twelve thirteen"],"picture":"y"}]}';
    expect(parseBriefs(text)).toEqual([{ headline: ["AI answers are changing", "how brands get found"], picture: "a crystal brain on a glass pedestal" }]);
  });
  it("returns nothing for a reply without JSON", () => {
    expect(parseBriefs("sorry")).toEqual([]);
  });
});

describe("requestProgress", () => {
  it("starts the first options while nothing is running", () => {
    expect(requestProgress([])).toMatchObject({ status: "preparing", start_brief: 0 });
  });
  it("is ready once its one design is done", () => {
    expect(requestProgress([done])).toMatchObject({ status: "ready", stage: "ready", options_ready: 1, start_brief: null });
  });
  it("replaces a design that did not finish, from the next brief", () => {
    expect(requestProgress([failed])).toMatchObject({ status: "preparing", start_brief: 1 });
    expect(requestProgress([failed, finishing])).toMatchObject({ status: "preparing", stage: "finishing", start_brief: null });
  });
  it("reports designing while the design is still being drawn", () => {
    expect(requestProgress([designing])).toMatchObject({ stage: "designing", start_brief: null });
  });
  it("is ready when a replacement finished", () => {
    const jobs = [...Array(MAX_CANDIDATES - 1).fill(failed), done];
    expect(requestProgress(jobs)).toMatchObject({ status: "ready", options_ready: 1 });
  });
  it("still honors a request that asked for more than one", () => {
    expect(requestProgress([done, failed, finishing], 3, 5)).toMatchObject({ status: "preparing", stage: "finishing", start_brief: null });
  });
  it("closes quietly when nothing finished, so a new request is made later", () => {
    expect(requestProgress(Array(MAX_CANDIDATES).fill(failed))).toMatchObject({ status: "closed", options_ready: 0, start_brief: null });
  });
  it("never replaces a video that did not finish: its one option bought its one clip", () => {
    expect(candidatesFor("video")).toBe(VIDEO_CANDIDATES);
    expect(VIDEO_CANDIDATES).toBe(1);
    expect(requestProgress([failed], 1, 3, candidatesFor("video"))).toMatchObject({ status: "closed", options_ready: 0, start_brief: null });
    expect(requestProgress([], 1, 3, candidatesFor("video"))).toMatchObject({ status: "preparing", start_brief: 0 });
  });
  it("keeps three candidates for stills", () => {
    for (const kind of ["single", "carousel", undefined]) {
      expect(candidatesFor(kind)).toBe(MAX_CANDIDATES);
      expect(requestProgress([failed], 1, 3, candidatesFor(kind))).toMatchObject({ status: "preparing", start_brief: 1 });
    }
  });
});

import { optionStates, parseCarouselBriefs } from "../../../functions/_shared/canva/options";

describe("parseCarouselBriefs", () => {
  const slide = (n: number) => ({ headline: [`Point ${n}`], picture: `scene ${n}` });
  it("keeps options with every slide asked for, cover first", () => {
    const text = JSON.stringify({ options: [{ slides: [1, 2, 3].map(slide) }, { slides: [1, 2].map(slide) }] });
    expect(parseCarouselBriefs(text, 3)).toEqual([{ headline: ["Point 1"], picture: "scene 1", slides: [1, 2, 3].map(slide) }]);
  });
  it("drops an option with a malformed slide", () => {
    const text = JSON.stringify({ options: [{ slides: [slide(1), { headline: [], picture: "x" }, slide(3)] }] });
    expect(parseCarouselBriefs(text, 3)).toEqual([]);
  });
});

describe("optionStates", () => {
  it("counts a carousel option done only when every slide is", () => {
    const jobs = [0, 1, 2].map((i) => ({ option_index: 0, slide_count: 3, status: i < 2 ? "done" : "running", step: i < 2 ? "finished" : "edit" } as const));
    expect(optionStates(jobs as never)).toEqual([{ status: "running", step: "finishing" }]);
    const all = [0, 1, 2].map(() => ({ option_index: 0, slide_count: 3, status: "done", step: "finished" } as const));
    expect(optionStates(all as never)).toEqual([{ status: "done", step: "finished" }]);
  });
  it("counts an option failed when any slide failed", () => {
    const jobs = [{ option_index: 1, slide_count: 2, status: "failed", step: "edit" }, { option_index: 1, slide_count: 2, status: "running", step: "generate" }];
    expect(optionStates(jobs as never)).toEqual([{ status: "failed", step: "failed" }]);
  });
  it("counts a canceled option as ended, so its request starts another or settles", () => {
    const jobs = [
      { option_index: 0, slide_count: null, status: "failed", step: "assemble_wait" },
      { option_index: 1, slide_count: null, status: "canceled", step: "title" },
    ];
    expect(optionStates(jobs as never)).toEqual([{ status: "failed", step: "failed" }, { status: "failed", step: "failed" }]);
    expect(requestProgress(optionStates(jobs as never), 1, 3)).toMatchObject({ status: "preparing", start_brief: 2 });
  });
  it("counts a video as designing until its clip is ordered, and finishing from then on", () => {
    const at = (step: string, footage_upload: string | null = null) => optionStates([{ option_index: 0, slide_count: null, status: "running", step, input: { kind: "video", footage_upload } }] as never)[0].step;
    for (const step of ["kit", "kit_wait", "title", "title_check", "frame", "frame_check", "clip"]) expect(at(step)).toBe("generate");
    for (const step of ["clip_wait", "assemble", "assemble_wait"]) expect(at(step)).toBe("finishing");
    // A filmed clip needs no footage made: its title and logo are its finishing.
    expect(at("title", "c/clip.mp4")).toBe("finishing");
  });
  it("treats a single design as an option of one", () => {
    expect(optionStates([{ option_index: 0, slide_count: null, status: "done", step: "finished" }] as never)).toEqual([{ status: "done", step: "finished" }]);
  });
});

import { chosenPosts, parseBriefs as parseWithLibrary, recentLines } from "../../../functions/_shared/canva/options";

describe("the client's library", () => {
  const library = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"];
  it("reads the posts a brief builds on, by their numbers, keeping at most two", () => {
    expect(chosenPosts([3, 1, 2], library)).toEqual(["c.jpg", "a.jpg"]);
    expect(chosenPosts([9, "2", 2], library)).toEqual(["b.jpg"]);
    expect(chosenPosts("3", library)).toEqual([]);
  });
  it("keeps each brief's chosen posts and layout", () => {
    const text = JSON.stringify({ options: [{ posts: [4], layout: "quote card with portrait", headline: ["Trust is earned"], picture: "a founder at a glass desk" }] });
    expect(parseWithLibrary(text, library)).toEqual([{ headline: ["Trust is earned"], picture: "a founder at a glass desk", refs: ["d.jpg"], layout: "quote card with portrait" }]);
  });
  it("tells the planner what recent designs were built on, by the same numbers", () => {
    const text = recentLines([{ refs: ["c.jpg"], layout: "space cover", picture: "a satellite dish" }, { refs: ["gone.jpg"], layout: null, picture: "a rocket" }], library);
    expect(text).toContain("- built on Post 3, space cover: a satellite dish");
    expect(text).toContain("- built on posts no longer in this set: a rocket");
    expect(recentLines([], library)).toBe("");
  });
});

import { leastRecentPosts, withRefs } from "../../../functions/_shared/canva/options";

describe("leastRecentPosts", () => {
  const library = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"];
  it("takes never-used posts first, then the ones used longest ago", () => {
    const recent = [
      { refs: ["a.jpg"], layout: null, picture: "newest" },
      { refs: ["c.jpg"], layout: null, picture: "older" },
    ];
    expect(leastRecentPosts(library, recent)).toEqual(["b.jpg", "d.jpg"]);
    expect(leastRecentPosts(library, [...recent, { refs: ["b.jpg", "d.jpg"], layout: null, picture: "oldest" }])).toEqual(["b.jpg", "d.jpg"]);
    expect(leastRecentPosts(["a.jpg", "c.jpg"], recent)).toEqual(["c.jpg", "a.jpg"]);
  });
  it("gives each brief without chosen posts different posts, and keeps the planner's choices", () => {
    const briefs = withRefs([
      { headline: ["one"], picture: "p1" },
      { headline: ["two"], picture: "p2", refs: ["a.jpg"] },
      { headline: ["three"], picture: "p3" },
    ], library, []);
    expect(briefs[0].refs).toEqual(["a.jpg", "b.jpg"]);
    expect(briefs[1].refs).toEqual(["a.jpg"]);
    expect(briefs[2].refs).toEqual(["c.jpg", "d.jpg"]);
  });
});

describe("plannerPrompt", () => {
  const args = { brand: "Pay The Pyper", platform: "Instagram", copy: "Captains pay last.", voice: null, count: 3, postCount: 8, recent: "" };

  it("tells the planner a Story is seen full screen for a few seconds, and keeps the headline limits", () => {
    const story = plannerPrompt({ ...args, story: true });
    expect(story).toContain("This post is a Story: its frame is seen full screen for a few seconds, so the headline carries the message, and a second line may carry the call to action.");
    expect(story).toContain("One line of at most 8 words, optionally a second, shorter line.");
  });

  it("says nothing of Stories for a feed post", () => {
    expect(plannerPrompt(args)).not.toContain("Story");
  });
});

describe("posts from other platforms", () => {
  const args = { brand: "Bader Law", platform: "LinkedIn", copy: "Injured at work? Know your rights.", voice: null, count: 3, postCount: 6, recent: "" };
  const line = "Each post is labeled with the platform it was published on and its date, LinkedIn's own posts first. Posts from other platforms show the brand, not LinkedIn's layout.";
  it("tell the planner they show the brand, not the post's platform's layout", () => {
    expect(plannerPrompt({ ...args, otherPlatforms: true })).toContain(line);
    expect(carouselPlannerPrompt({ ...args, slides: 5, otherPlatforms: true })).toContain(line);
    expect(videoPlannerPrompt({ ...args, otherPlatforms: true })).toContain(line);
    expect(videoPlannerPrompt({ ...args, filmed: "its founder", otherPlatforms: true })).toContain(line);
  });
  it("say nothing when every post is the platform's own", () => {
    expect(plannerPrompt(args)).not.toContain("other platforms");
    expect(plannerPrompt(args).split("\n")[1]).not.toBe("");
  });
});

// Notes on regenerate (Lital, 3 Nov 2026): the note a design was asked with
// reaches every planner, and every option follows it.
describe("a note on Regenerate", () => {
  const args = { brand: "Pay The Pyper", platform: "Instagram", copy: "Captains pay last.", voice: null, count: 3, postCount: 8, recent: "" };
  const line = 'A note from the person who asked for this design: "Show the rink at night, no people". Every option follows it.';
  const style = { format: "cinematic reels", subjects: "rinks", shots: "fast cuts", camera: "handheld", look: "cold blue", people: "none" as const, on_screen_text: "titles" as const, text_style: "bold white", logo: "shown" as const, sound: "music", other_formats: "" };

  it("is one line in every planner, before the options are described", () => {
    const note = "Show the rink at night, no people";
    const prompts = {
      single: plannerPrompt({ ...args, note }),
      story: plannerPrompt({ ...args, story: true, note }),
      carousel: carouselPlannerPrompt({ ...args, slides: 5, note }),
      video: videoPlannerPrompt({ ...args, note }),
      videoFromStyle: videoPlannerPrompt({ ...args, style, videos: 3, framesPer: 8, note }),
      filmed: videoPlannerPrompt({ ...args, filmed: "its founder", note }),
    };
    for (const [kind, p] of Object.entries(prompts)) {
      expect(p.split("\n").filter((l) => l === line), kind).toHaveLength(1);
      expect(p.indexOf(line), kind).toBeLessThan(p.indexOf("For each option give:"));
      expect(p.indexOf(line), kind).toBeGreaterThan(p.indexOf('"""Captains pay last."""'));
    }
  });

  it("is absent when there is no note", () => {
    for (const p of [plannerPrompt(args), plannerPrompt({ ...args, note: "" }), carouselPlannerPrompt({ ...args, slides: 5, note: null }), videoPlannerPrompt(args)]) {
      expect(p).not.toContain("A note from the person");
    }
  });
});
