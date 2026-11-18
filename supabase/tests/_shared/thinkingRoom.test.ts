// @vitest-environment node
// Every call to a model that thinks before it answers leaves room for the
// thinking, and reads its reply as no answer when the reply did not finish
// (anthropicReply.ts). The thinking counts toward max_tokens, so a limit
// sized for the answer alone came back cut off with little or no answer, and
// the read of a logo's place was stored that way for three clients
// (18 Nov 2026). Two things are held here, from the source, because the
// worker and request functions cannot be loaded by a test:
//   * no call sends a limit smaller than the room, however the limit is
//     written (a number, a name, a choice), except the ones listed with the
//     reason each is not this fault;
//   * the calls of those functions size their limit with roomFor and read
//     their reply through answerText.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { THINKING_ROOM } from "../../functions/_shared/anthropicReply";
import { functionsDir } from "../paths.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
// A mention in a comment is not a call. A block comment is one that opens a line: "/*" inside a string or a pattern is code.
const code = (file: string) => readFileSync(file, "utf8").replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const source = (name: string) => code(join(functionsDir, ...name.split("/")));
const count = (text: string, part: string) => text.split(part).length - 1;

/**
 * What a call's `max_tokens` comes to, read from the source: "room" when it
 * is sized with roomFor, the numbers it may be (one, or each side of a
 * choice), or "unseen" when the file does not say (a parameter, say). A name
 * is followed to its `const` in the same file.
 */
function limitOf(expr: string, text: string, depth = 0): "room" | "unseen" | number[] {
  if (/\broomFor\(/.test(expr)) return "room";
  const numbers = [...expr.matchAll(/(?<![\w.])\d[\d_]*\b/g)].map((m) => Number(m[0].replace(/_/g, "")));
  if (numbers.length) return numbers;
  const name = /^[A-Za-z_$][\w$]*$/.exec(expr.trim())?.[0];
  const made = name && depth < 3 ? new RegExp(`\\bconst\\s+${name.replace(/\$/g, "\\$")}\\s*(?::[^=\\n]+)?=\\s*([^;\\n]+)`).exec(text)?.[1] : null;
  return made ? limitOf(made, text, depth + 1) : "unseen";
}

/** The value written after a property's colon: up to the comma or closing brace that ends it, outside any brackets of its own. */
function valueAt(rest: string): string {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (depth > 0 && (ch === ")" || ch === "]" || ch === "}")) depth--;
    else if (ch === "," || ch === "}" || ch === ")" || ch === "\n") return rest.slice(0, i);
  }
  return rest;
}

/** Every limit a file sends, however it is written: a number, a name, a choice between two. */
function limitsIn(text: string): Array<"room" | "unseen" | number[]> {
  return [...text.matchAll(/\bmax_tokens\s*:\s*/g)].map((m) => limitOf(valueAt(text.slice(m.index! + m[0].length)), text));
}
const small = (limit: "room" | "unseen" | number[]) => limit === "unseen" || (Array.isArray(limit) && limit.some((n) => n < THINKING_ROOM));

/** Files with a call whose limit is smaller than the room, or cannot be seen here, each with why it is not this fault. */
const SMALL_LIMITS: Record<string, string> = {
  "_shared/brand-references/discover.ts": "Claude Haiku 4.5, which thinks only when a request asks it to",
  "_shared/brand-references/learnStyle.ts": "Claude Sonnet 4.6, which thinks only when a request asks it to",
  "_shared/brand/research.ts": "an OpenAI model",
  "_shared/competitive/identify.ts": "3,000, then 6,000 once when the first reply was cut off: its own second try, and a reply that is not JSON fails the run",
  "_shared/competitive/refreshFeed.ts": "Claude Sonnet 4.6, which thinks only when a request asks it to",
  "_shared/design-prompts/feedback.ts": "Claude Haiku 4.5, which thinks only when a request asks it to",
  "_shared/design-prompts/measureLogo.ts": "Claude Sonnet 4.6, which thinks only when a request asks it to",
  "_shared/design-prompts/referenceTemplate.ts": "Claude Sonnet 4.6, and a reply that stopped at its limit is refused there",
  "_shared/design-prompts/validateImage.ts": "6,000 with effort set to medium for a verdict of a few fields (1,000 on Claude Sonnet 4.6), ended at 45 seconds, and a verdict that did not finish is a review that was skipped",
  "_shared/pipelines/social/analysis.ts": "the brief at 8,000 with effort set to low, the most an inline pipeline step may ask for; the pipeline checks the answer and asks once more",
  "_shared/reports/insights.ts": "8,000 with effort set to medium and a reply held to a schema: a cut-off reply does not parse, is asked for once more, and the figures' own words stand otherwise",
  "_shared/calendar/runMoments.ts": "8,000 and more with effort set to medium, and a reply that does not hold the list is asked for once more",
  "_shared/calendar/runWeek.ts": "12,000 and 16,000, sized with the thinking in them, and a week that does not parse is not kept",
  "build-design-system/index.ts": "Claude Sonnet 4.6, which thinks only when a request asks it to",
  "extract-brand-from-file/index.ts": "an OpenAI model",
  "generate-post-image/index.ts": "Claude Haiku 4.5, which thinks only when a request asks it to",
};

describe("room for thinking, across the functions", () => {
  it("reads a limit however it is written", () => {
    const text = "const CHECK = roomFor(2000);\nexport const MAX: number = 16_000;\nconst SMALL = 400;\nconst VIA = SMALL;";
    expect(limitsIn(`${text}\nbody: { model: m, max_tokens: 400, messages }`)).toEqual([[400]]);
    expect(limitsIn(`${text}\nmax_tokens: CHECK,`)).toEqual(["room"]);
    expect(limitsIn(`${text}\n{ max_tokens: MAX }`)).toEqual([[16000]]);
    expect(limitsIn(`${text}\nmax_tokens: VIA,`)).toEqual([[400]]);
    expect(limitsIn(`${text}\nmax_tokens: opts.creative ? 6000 : 1000,`)).toEqual([[6000, 1000]]);
    expect(limitsIn(`${text}\nmax_tokens: roomFor(carousel ? 6000 : video ? 4000 : 2000),`)).toEqual(["room"]);
    expect(limitsIn(`${text}\nmax_tokens: maxTokens,`)).toEqual(["unseen"]);
    expect(limitsIn(`${text}\nbody: { model: m, max_tokens: MAX, messages: [{ role: "user", content }] } });`)).toEqual([[16000]]);
    expect(limitsIn(`${text}\nJSON.stringify({ model: "m", max_tokens: 350 })`)).toEqual([[350]]);
    expect([[400], "unseen", [16000, 1000]].map((l) => small(l as never))).toEqual([true, true, true]);
    expect(["room", [16000], [32000, 16000]].map((l) => small(l as never))).toEqual([false, false, false]);
  });

  it("no call sends a limit smaller than the room, or one that cannot be seen, outside the listed ones", () => {
    const found = new Map<string, Array<"room" | "unseen" | number[]>>();
    for (const file of walk(functionsDir)) {
      const limits = limitsIn(code(file));
      if (limits.length) found.set(relative(functionsDir, file).split(sep).join("/"), limits);
    }
    // The scan sees the calls: the ones this fault was fixed in are sized with roomFor.
    for (const file of ["_shared/lifecycle/imaging.ts", "_shared/strategy/write.ts", "_shared/notes/run.ts", "_shared/voice/load.ts", "_shared/trends/coverage.ts", "design-worker/index.ts"]) expect(found.get(file), file).toContain("room");
    const unlisted = [...found].filter(([file, limits]) => !(file in SMALL_LIMITS) && limits.some(small)).map(([file, limits]) => `${file}: ${JSON.stringify(limits)}`);
    expect(unlisted, "a model that thinks first needs max_tokens: roomFor(the answer's size), from _shared/anthropicReply.ts").toEqual([]);
    // The list holds no file whose limits are all large or sized with roomFor now.
    expect(Object.keys(SMALL_LIMITS).filter((file) => !(found.get(file) ?? []).some(small))).toEqual([]);
  });

  it("the design request plans, checks who is on camera and writes a shot brief with room, and reads each reply as an answer only when it finished", () => {
    const text = source("design-request/index.ts");
    expect(count(text, "anthropicMessages({")).toBe(3);
    expect(text).toContain("max_tokens: roomFor(carousel ? 6000 : video ? 4000 : 2000)");
    expect(count(text, "max_tokens: roomFor(2000)")).toBe(2);
    expect(count(text, "answerText(result)")).toBe(3);
    expect(text).not.toContain("result.text");
    // The planner's two tries are the two there were: a try whose plan did not finish plans nothing, and the next one asks again.
    expect(text).toContain("for (let attempt = 0; attempt < 2 && briefs.length < OPTIONS_WANTED; attempt++)");
    expect(text).toContain('if (!briefs.length) throw new Error("The options could not be planned.");');
  });

  it("the design worker's checks have room, and an answer that did not finish is asked again like any unreadable one", () => {
    const text = source("design-worker/index.ts");
    expect(text).toContain("const CHECK_TOKENS = roomFor(2000);");
    expect(count(text, "anthropicMessages({")).toBe(1);
    expect(text).toContain("max_tokens: CHECK_TOKENS,");
    expect(text).toContain("return answerText(result);");
    expect(text).not.toContain("result.text");
    expect(text).toContain("const READ_TRIES = 3;");
    // A check's tries share one wait, so three long thinks in a row end inside the lease the job is held under.
    expect(text).toContain("const CHECK_WAIT_MS = 100_000;");
    expect(text).toContain("const MODEL_LEASE_MS = 420_000;");
    expect(text).toContain("const until = Date.now() + CHECK_WAIT_MS;");
    expect(text).toContain("last = await ask(left);");
    expect(count(text, "readCheck((wait) => askAbout(")).toBe(5);
    // Every check passes its wait on: there is no call without one.
    expect(count(text, "readCheck(")).toBe(5);
    expect(text).toMatch(/max_tokens: CHECK_TOKENS,[\s\S]{0,400}?\n {4}waitMs,\n/);
  });

  it("the video steps' checks and the read of a client's videos have room, and none reads a reply that did not finish", () => {
    const text = source("_shared/video/steps.ts");
    expect(text).toContain("const CHECK_TOKENS = roomFor(2000);");
    expect(count(text, "anthropicMessages({")).toBe(6);
    expect(count(text, "max_tokens: CHECK_TOKENS")).toBe(5);
    expect(count(text, "max_tokens: roomFor(4000)")).toBe(1);
    expect(count(text, "answerText(result)")).toBe(6);
    expect(text).not.toContain("result.text");
  });

  it("no changed call sets thinking or effort to bound the model", () => {
    for (const name of ["design-request/index.ts", "design-worker/index.ts", "_shared/video/steps.ts", "_shared/lifecycle/imaging.ts", "revise-suggestion/index.ts", "generate-ad-hoc-post/index.ts", "regenerate-post-copy/index.ts", "_shared/voice/load.ts"]) {
      const text = source(name);
      expect(text, name).not.toMatch(/\bthinking\s*:/);
      expect(text, name).not.toMatch(/\boutput_config\s*:/);
    }
  });
});
