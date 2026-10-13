import { describe, it, expect } from "vitest";
import { MAX_CANDIDATES, parseBriefs, requestProgress, type JobState } from "./options";

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
  it("is ready once three options are done", () => {
    expect(requestProgress([done, done, done])).toMatchObject({ status: "ready", stage: "ready", options_ready: 3, start_brief: null });
  });
  it("replaces an option that did not finish, from the next brief", () => {
    expect(requestProgress([done, failed, finishing])).toMatchObject({ status: "preparing", stage: "finishing", start_brief: 3 });
  });
  it("reports designing while any option is still being drawn", () => {
    expect(requestProgress([designing, finishing, finishing])).toMatchObject({ stage: "designing", start_brief: null });
  });
  it("offers what finished when the replacements run out", () => {
    const jobs = [done, ...Array(MAX_CANDIDATES - 1).fill(failed)];
    expect(requestProgress(jobs)).toMatchObject({ status: "ready", options_ready: 1 });
  });
  it("goes to staff, never to the person who asked, when nothing finished", () => {
    expect(requestProgress(Array(MAX_CANDIDATES).fill(failed))).toMatchObject({ status: "needs_staff", options_ready: 0 });
  });
});

import { optionStates, parseCarouselBriefs } from "./options";

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
  it("treats a single design as an option of one", () => {
    expect(optionStates([{ option_index: 0, slide_count: null, status: "done", step: "finished" }] as never)).toEqual([{ status: "done", step: "finished" }]);
  });
});
