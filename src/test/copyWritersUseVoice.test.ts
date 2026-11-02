// Every piece of code that asks a model for a client's post copy builds its
// prompt from the shared voice (supabase/functions/_shared/voice): the team's
// preferences, the client's real social voice, then the brief. Lital, 19 Oct
// 2026: copy must use the client's persistent preferences and its actual
// social media voice. A new copy writer that skips them fails the build.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { voicePromptBlock } from "../../supabase/functions/_shared/voice/voice";

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

  // Client notes (2 Nov 2026): what the client told the team reaches every
  // copy prompt through the same voice, so every writer above gets it.
  it("loads what the client told the team into the voice, and the voice block prints it first", () => {
    const load = all.find((f) => f.path === "_shared/voice/load.ts")!;
    for (const call of ["readNoteRows(", "pointsInUse(", "standingNotes(client.brand_notes)"]) expect(load.text).toContain(call);
    const block = voicePromptBlock({
      brand: "Bader Law", preferences: [], social: null, briefTone: null,
      notes: { today: "2026-11-02", standing: "No slang.", points: [{ id: "p1", note_id: "n1", kind: "avoid", text: 'Never say "cheap".', platform: null, said_on: null, until: null, created_at: "2026-10-28T00:00:00Z", date: "2026-10-28" }] },
    }, { platforms: ["Instagram"] });
    expect(block).toContain('1. What Bader Law told the team.');
    expect(block).toContain("Standing notes from the team:\nNo slang.");
    expect(block).toContain('- Oct 28: Never say "cheap".');
  });
});
