// @vitest-environment node
// The words check and a carousel's designs (18 Nov 2026). The post's own
// words and the lettering printed on objects in its picture are read apart:
// the headline is still compared exactly, and the lettering must be real
// words spelled right. A carousel's slide after the cover that has made its
// own designs may use what its option's finished slides left, so one hard
// slide no longer ends an option whose other slides are done.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEADLINE_RUN, parseRead, parseReading, postReadPrompt, readPrompt, readingFails, repeatsHeadline } from "../../../functions/_shared/design/pipeline";
import { MAX_GENERATIONS, OF_THE_DESIGN, endedFor, runGenerate, slideAllowance } from "../../../functions/_shared/design/modelSteps";
import { REASONS } from "../../../functions/_shared/design/logoChoice";

// Invented copy: no client's words.
const HEADLINE = ["Bright mornings start early.", "Pack the green thermos today."];

describe("the reading of a design", () => {
  it("asks for the post's own words and the lettering on objects in two groups, and leaves out the logo", () => {
    const p = postReadPrompt("Brand");
    expect(p).toContain('"lines"');
    expect(p).toContain('"scene"');
    expect(p).toContain('"scene_spelled"');
    expect(p).toContain("Leave out the Brand logo.");
    // A video's title layer is read as one group, as it always was.
    expect(readPrompt("Brand")).toBe('Transcribe every piece of text in this image exactly as written, in reading order, keeping spelling, capitalization and punctuation. Leave out the Brand logo. Reply with JSON only: {"lines":["..."]}');
  });

  it("passes a design whose headline is exact and whose picture shows a calendar's days", () => {
    const r = parseReading('{"lines":["Bright mornings start early.","Pack the green thermos today."],"scene":["SUN MON TUE WED THU FRI SAT","12"],"scene_spelled":true}')!;
    expect(r.scene).toHaveLength(2);
    expect(readingFails(r, HEADLINE)).toBeNull();
  });

  it("still refuses a wrong, missing or added word of the post's own, whatever the picture shows", () => {
    expect(readingFails({ lines: ["Bright mornings start erly.", "Pack the green thermos today."], scene: [], sceneSpelled: true }, HEADLINE)).toBe("words");
    expect(readingFails({ lines: ["Bright mornings start early."], scene: ["Pack the green thermos today."], sceneSpelled: true }, HEADLINE)).toBe("words");
    expect(readingFails({ lines: [...HEADLINE, "Learn more"], scene: [], sceneSpelled: true }, HEADLINE)).toBe("words");
  });

  it("refuses lettering on an object that is misspelled or invented", () => {
    const r = parseReading('{"lines":["Bright mornings start early.","Pack the green thermos today."],"scene":["Patiient Infromation"],"scene_spelled":false}')!;
    expect(readingFails(r, HEADLINE)).toBe("scene");
  });

  it("takes lettering whose spelling the reply does not vouch for as not spelled right", () => {
    expect(parseReading('{"lines":["A"],"scene":["Name:"]}')!.sceneSpelled).toBe(false);
    expect(parseReading('{"lines":["A"],"scene":["Name:"],"scene_spelled":"yes"}')!.sceneSpelled).toBe(false);
    // No lettering on objects: nothing to vouch for.
    expect(parseReading('{"lines":["A"],"scene":[]}')!.sceneSpelled).toBe(true);
    expect(parseReading('{"lines":["A"],"scene":["  "]}')!.scene).toEqual([]);
  });

  it("reads a reply in the one group of before as it always was: every word counted as the post's", () => {
    const r = parseReading('Here you go: {"lines":["One","Two"]}')!;
    expect(r).toEqual({ lines: ["One", "Two"], scene: [], sceneSpelled: true });
    expect(readingFails(r, ["One", "Two"])).toBeNull();
    expect(readingFails(parseReading('{"lines":["One","Two","MON TUE"]}')!, ["One", "Two"])).toBe("words");
    expect(parseRead('{"lines":["One"],"scene":["X"]}')).toEqual(["One"]);
    expect(parseReading("no text found")).toBeNull();
    expect(parseReading('{"scene":["X"]}')).toBeNull();
  });

  it("keeps the lettering read on a design among what goes when a new design is made, and names it as a reason", () => {
    expect(OF_THE_DESIGN).toContain("read_scene");
    expect(REASONS.scene(["Patiient"])).toMatch(/^scene: /);
  });
});

describe("lettering on an object that repeats the headline", () => {
  const ok = (scene: string[]) => readingFails({ lines: HEADLINE, scene, sceneSpelled: true }, HEADLINE);
  it("refuses a whole headline line drawn on an object, in any case and punctuation", () => {
    expect(ok(["BRIGHT MORNINGS START EARLY"])).toBe("words");
    expect(ok(["Sale! Pack the green thermos today!"])).toBe("words");
    expect(repeatsHeadline("Bright mornings, start early", HEADLINE)).toBe(true);
  });
  it("refuses three or more headline words in a row, also across the headline's lines", () => {
    expect(ok(["the green thermos"])).toBe("words");
    expect(ok(["start early. Pack"])).toBe("words");
    expect(HEADLINE_RUN).toBe(3);
  });
  it("passes lettering that shares fewer headline words in a row, or none", () => {
    expect(ok(["green tea"])).toBeNull();
    expect(ok(["Pack the"])).toBeNull();
    expect(ok(["early", "today", "thermos"])).toBeNull();
    expect(ok(["MON TUE WED"])).toBeNull();
  });
  it("passes a pictured phone's clock read as lettering on the phone", () => {
    const r = parseReading('{"lines":["Bright mornings start early.","Pack the green thermos today."],"scene":["9:41"],"scene_spelled":true}')!;
    expect(readingFails(r, HEADLINE)).toBeNull();
  });
  it("still refuses the clock when the reader counts it as the post's own text", () => {
    expect(readingFails({ lines: [...HEADLINE, "9:41"], scene: [], sceneSpelled: true }, HEADLINE)).toBe("words");
  });
});

describe("the verify step", () => {
  const worker = readFileSync(new URL("../../../functions/design-worker/index.ts", import.meta.url), "utf8");
  const verify = worker.slice(worker.indexOf('case "verify": {'), worker.indexOf("throw new Error(`FINAL: Unknown step"));
  it("reads the design and the Story's band in the two groups and judges both by readingFails", () => {
    expect(verify.match(/parseReading/g)).toHaveLength(2);
    expect(verify.match(/readingFails\(/g)).toHaveLength(2);
    expect(verify.match(/postReadPrompt\(g\.brand_name\)/g)).toHaveLength(2);
    expect(verify).not.toMatch(/copyMatches|parseRead\b|[^t]readPrompt/);
    expect(verify).toContain("REASONS.scene(reading.scene)");
    // The Story's band names lettering on an object as such, and its own words as the band's.
    expect(verify).toContain('bandWrong === "scene" ? REASONS.scene(inBand.scene) : REASONS.band(s.band_read)');
  });
});

describe("why a job ended", () => {
  it("names the check that sent its last design back", () => {
    expect(endedFor(["marks: x", "words: read as []"])).toBe("The design could not be made with the headline's exact words.");
    expect(endedFor(["words: x", "scene: lettering on an object"])).toBe("The design could not be made with clear, correctly spelled lettering in its picture.");
    expect(endedFor(["scene: x"])).not.toMatch(/headline/);
    expect(endedFor(["words: x", "marks: drawn in the picture"])).toBe("The design could not be made free of logos and brand marks drawn in the picture.");
    expect(endedFor(["ground: no logo file shows"])).toBe("The design could not be made with the logo in its place.");
    expect(endedFor(["logo's place: touched by a line"])).toBe("The design could not be made with the logo in its place.");
  });
  it("says what it always said when no reason was kept", () => {
    expect(endedFor(undefined)).toBe("The design could not be made with the headline's exact words and the logo in its place.");
    expect(endedFor([])).toBe("The design could not be made with the headline's exact words and the logo in its place.");
  });
  it("is the reason a job that used its designs ends with", () => {
    const job = { id: "j", client_id: "c", step: "generate", state: { generations: MAX_GENERATIONS, redesigns: ["words: read as [\"x\"]"] } };
    expect(() => runGenerate({ canvas: async () => 0, draw: async () => new Uint8Array(), store: async () => {}, save: async () => {} }, job, () => "held"))
      .toThrow("FINAL: The design could not be made with the headline's exact words.");
  });
});

describe("a carousel's slide after the cover that has made its own designs", () => {
  const M = MAX_GENERATIONS;
  const me = (generations: number, forCover?: number) => ({ id: "me", state: { generations, ...(forCover ? { for_cover: forCover } : {}) } });
  const row = (id: string, status: string, generations: number, forCover?: number) => ({ id, status, state: { generations, ...(forCover ? { for_cover: forCover } : {}) } });

  it("makes one more when a finished slide left a design unused", () => {
    expect(slideAllowance(me(M), [row("me", "running", M), row("a", "done", 1), row("b", "done", M)])).toBe("more");
  });

  it("uses no more than the option's share: each finished slide's unused designs, less what slides used past their own", () => {
    // Two finished slides with one design each leave 2 * (M - 1).
    const others = [row("a", "done", 1), row("b", "done", 1)];
    let n = M;
    while (slideAllowance(me(n), others) === "more") n += 1;
    expect(n).toBe(M + 2 * (M - 1));
    // What a finished slide used past its own share is spent already.
    expect(slideAllowance(me(M), [row("a", "done", 1), row("b", "done", M + M - 1)])).toBe("over");
    // A slide still at work past its own share has taken a free design already.
    expect(slideAllowance(me(M), [row("a", "done", M - 1), row("b", "running", M + 1)])).toBe("over");
  });

  it("waits while a slide at work may still leave one, and ends when none can", () => {
    expect(slideAllowance(me(M), [row("a", "running", 1), row("b", "done", M)])).toBe("wait");
    expect(slideAllowance(me(M), [row("a", "running", M), row("b", "done", M)])).toBe("over");
    expect(slideAllowance(me(M), [row("a", "queued", 0)])).toBe("wait");
  });

  it("shares nothing once a slide of the option failed or was stopped", () => {
    expect(slideAllowance(me(M), [row("a", "failed", M), row("b", "done", 1)])).toBe("over");
    expect(slideAllowance(me(M), [row("a", "canceled", 1), row("b", "done", 1)])).toBe("over");
  });

  it("counts only the slides drawn for the same design of the cover", () => {
    // A row still for the cover's earlier design counts for nothing.
    expect(slideAllowance(me(M, 2), [row("a", "done", 1, 1)])).toBe("over");
    expect(slideAllowance(me(M, 2), [row("a", "done", 1, 2)])).toBe("more");
  });

  it("is made by runGenerate past the job's own designs only when it is free", async () => {
    const job = { id: "j", client_id: "c", step: "generate", state: { generations: M } as Record<string, unknown> };
    let drawn = 0;
    let held: Promise<void> = Promise.resolve();
    const deps = { canvas: async () => 0, draw: async () => { drawn += 1; return new Uint8Array([1]); }, store: async () => {}, save: async () => {} };
    expect(() => runGenerate(deps, job, () => "held")).toThrow(/^FINAL: /);
    expect(runGenerate(deps, job, (work) => { held = work(); return "held"; }, true)).toBe("held");
    await held;
    expect(drawn).toBe(1);
    expect(job.state.generations).toBe(M + 1);
    expect(job.step).toBe("locate");
  });

  it("is asked by the worker's generate step for a slide after the cover that has made its own designs", () => {
    const worker = readFileSync(new URL("../../../functions/design-worker/index.ts", import.meta.url), "utf8");
    const generate = worker.slice(worker.indexOf('case "generate": {'), worker.indexOf('case "locate": {'));
    expect(generate).toContain("(s.generations ?? 0) >= MAX_GENERATIONS");
    expect(generate).toContain("slideAllowance(job, slides ?? [])");
    expect(generate).toContain('if (allowance === "wait") return "wait";');
    expect(generate).toContain("job, (work) => hold(admin, job, work), more);");
  });
});
