// Designs are made on request only (Lital, 2 Nov 2026: "one button to design
// a whole week's posts, on request only, never automatic"): a post's own
// "Create design", or the week's design button. Every design spends paid
// credits, so nothing may start one on its own again. This scans the app and
// the edge functions, like displayGuard.test.ts, and fails the build when the
// automatic designs' switch, their planner or their action comes back, or
// when a design request is written without naming the person who asked
// (design_requests also refuses it since 20261109110000_design_week_runs.sql).

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..", "..");
const SELF = relative(ROOT, __filename);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const sources = [...files(join(ROOT, "src")), ...files(join(ROOT, "supabase", "functions"))]
  .map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }))
  .filter((f) => f.path !== SELF && !f.path.startsWith("src/integrations/supabase/types.ts"));

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

describe("designs start only when a person asks", () => {
  it("scans the app and the edge functions", () => {
    const paths = sources.map((f) => f.path);
    expect(paths).toContain("supabase/functions/design-request/index.ts");
    expect(paths).toContain("src/pages/ClientCalendar.tsx");
  });

  it("has no automatic designs: no switch, no planner, no action", () => {
    const hits = sources.flatMap((f) => [...f.text.matchAll(/auto_designs|prepareUpcoming|action\s*===?\s*["']auto["']|action:\s*["']auto["']/g)]
      .map((m) => `${f.path}:${lineOf(f.text, m.index!)}: ${m[0]}`));
    expect(hits).toEqual([]);
  });

  it("names a person on every design request it writes", () => {
    const inserts = sources.flatMap((f) => [...f.text.matchAll(/from\(["']design_requests["']\)\s*\.insert\(/g)]
      .map((m) => ({ where: `${f.path}:${lineOf(f.text, m.index!)}`, call: f.text.slice(m.index!, f.text.indexOf("}).select", m.index!) + 1) })));
    // The two ways a request is made: a design being prepared, and a video post that is filmed.
    expect(inserts.map((i) => i.where.split(":")[0])).toEqual(["supabase/functions/design-request/index.ts", "supabase/functions/design-request/index.ts"]);
    for (const i of inserts) {
      expect(i.call, i.where).toMatch(/requested_by:\s*p\.requestedBy\b/);
      expect(i.call, i.where).not.toMatch(/requested_by:\s*null/);
    }
    // And whoever calls those two must pass a person: the parameter is not optional.
    const index = sources.find((f) => f.path === "supabase/functions/design-request/index.ts")!.text;
    expect(index).toMatch(/async function startRequest\([^)]*requestedBy: string;/);
    expect(index).toMatch(/async function recordFilming\([^)]*requestedBy: string;/);
    expect(index).not.toMatch(/requestedBy:\s*null/);
  });
});
