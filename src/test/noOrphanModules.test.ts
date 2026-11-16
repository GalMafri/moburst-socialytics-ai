// Every module under src/components, src/lib and src/utils is imported by a
// module that is not a test. A module only a test imports, or nothing imports,
// is dead code that keeps a copy of old behavior alive (the retired generators
// and their dialogs did). The page route table is checked with it: the app
// declares no /dev/ route.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { appFiles, importGraph, SRC } from "./guardSource";

const MODULE_DIRS = /^(?:components|lib|utils)\//;

/** The modules a source folder holds that no non-test module imports (index files and a module's own imports do not count). */
export function orphans(graph: Map<string, string[]>, files: string[]): string[] {
  const imported = new Set([...graph].flatMap(([from, to]) => to.filter((t) => t !== from)));
  return files.filter((f) => !imported.has(f)).sort();
}

describe("no module that nothing imports", () => {
  const graph = importGraph();

  it("finds a module nothing imports, and leaves an imported one alone", () => {
    const sample = new Map([
      ["main.tsx", ["lib/used.ts"]],
      ["lib/used.ts", []],
      ["lib/dead.ts", ["lib/used.ts"]],
      ["lib/self.ts", ["lib/self.ts"]],
    ]);
    expect(orphans(sample, ["lib/used.ts", "lib/dead.ts", "lib/self.ts"])).toEqual(["lib/dead.ts", "lib/self.ts"]);
  });

  it("reads the modules the app has", () => {
    expect(appFiles().filter((f) => MODULE_DIRS.test(f)).length).toBeGreaterThan(150);
  });

  it("imports every module under src/components, src/lib and src/utils from a module that is not a test", () => {
    expect(orphans(graph, appFiles().filter((f) => MODULE_DIRS.test(f)))).toEqual([]);
  });

  it("declares no /dev/ route", () => {
    expect(readFileSync(join(SRC, "App.tsx"), "utf8")).not.toMatch(/path=["']\/dev\//);
  });
});
