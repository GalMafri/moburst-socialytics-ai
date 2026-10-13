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
