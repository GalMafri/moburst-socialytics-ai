// Every piece of code that asks a model for a client's post copy builds its
// prompt from the shared voice (supabase/functions/_shared/voice): the team's
// preferences, the client's real social voice, then the brief. Lital, 19 Oct
// 2026: copy must use the client's persistent preferences and its actual
// social media voice. A new copy writer that skips them fails the build.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..", "..", "supabase", "functions");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const ASKS_FOR_COPY = /caption_angle|"copy":"|\\"copy\\":/;
const CALLS_MODEL = /anthropicMessages\(|api\.anthropic\.com/;

describe("copy writers use the client's voice", () => {
  const all = files(ROOT).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));

  it("finds the copy writers it guards", () => {
    const writers = all.filter((f) => ASKS_FOR_COPY.test(f.text) && CALLS_MODEL.test(f.text)).map((f) => f.path).sort();
    expect(writers).toEqual(["generate-ad-hoc-post/index.ts", "regenerate-post-copy/index.ts"]);
  });

  it("builds every copy prompt from loadClientVoice and voicePromptBlock", () => {
    for (const f of all) {
      const writesCopy = ASKS_FOR_COPY.test(f.text) && CALLS_MODEL.test(f.text);
      // The week planner's prompts live in weekPlan.ts; whatever calls them writes copy.
      const usesWeekPrompts = /from "\.\/weekPlan\.ts"|from "\.\.\/calendar\/weekPlan\.ts"/.test(f.text) && CALLS_MODEL.test(f.text);
      if (!writesCopy && !usesWeekPrompts) continue;
      expect(f.text, f.path).toContain("loadClientVoice(");
      expect(f.text, f.path).toContain("voicePromptBlock(");
    }
  });

  it("keeps the week prompts taking the voice block", () => {
    const weekPlan = all.find((f) => f.path === "_shared/calendar/weekPlan.ts")!;
    expect(weekPlan.text).toMatch(/c\.voiceBlock/);
    const runWeek = all.find((f) => f.path === "_shared/calendar/runWeek.ts")!;
    expect(runWeek.text).toContain("loadClientVoice(");
  });
});
