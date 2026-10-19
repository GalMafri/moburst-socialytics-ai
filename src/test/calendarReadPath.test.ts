// The calendar has one read path (Lital, 19 Oct 2026): every screen and job
// reads calendar_posts_current, which shows each week's plan in force. Reading
// the calendar_posts table directly would show older plans' posts again, so
// only the code that writes posts may read it, at the places listed here.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["src", "supabase/functions", "api"];

/** Reads of the table by the code that writes posts: why each is not a calendar view. */
const ALLOWED: Record<string, string> = {
  "supabase/functions/_shared/calendar/fromReport.ts": "a report's own earlier run, to replace it",
  "supabase/functions/calendar-posts/index.ts": "posts a plan already placed in a week, to finish taking it",
};

function files(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(files(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith("types.ts")) out.push(path);
  }
  return out;
}

// from("calendar_posts") or from("calendar_posts" as never) as any), then .select(
const TABLE_READ = /\.from\(\s*["']calendar_posts["'](?:\s+as\s+never)?\s*\)(?:\s*as\s+any\s*\))?\s*\.select\(/g;

describe("calendar read path", () => {
  it("reads the calendar through calendar_posts_current everywhere but the writers", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const dir of SCAN) {
      for (const file of files(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const text = readFileSync(file, "utf8");
        const hits = [...text.matchAll(TABLE_READ)];
        if (!hits.length) continue;
        if (ALLOWED[rel]) { seen.add(rel); continue; }
        for (const h of hits) offenders.push(`${rel}:${text.slice(0, h.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
    // Every allowed read still exists; a stale entry would hide a new one.
    expect([...seen].sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});
