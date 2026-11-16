// Every source file under src is reached from src/main.tsx through imports. A
// file nothing reaches is dead: it still type-checks, still shows up in a
// search, and still gets edited by someone who thinks it runs. Tests, their
// helpers (src/test) and type declarations are not part of the app and are
// left out.

import { describe, expect, it } from "vitest";
import { appFiles, importGraph, reachable } from "../guardSource";

describe("every source file is used", () => {
  it("walks the imports from main.tsx, and reports a file nothing reaches", () => {
    const sample = new Map([
      ["main.tsx", ["App.tsx"]],
      ["App.tsx", ["lib/a.ts"]],
      ["lib/a.ts", []],
      ["lib/island.ts", ["lib/other.ts"]],
      ["lib/other.ts", ["lib/island.ts"]],
    ]);
    const seen = reachable(sample, ["main.tsx"]);
    expect([...sample.keys()].filter((f) => !seen.has(f))).toEqual(["lib/island.ts", "lib/other.ts"]);
  });

  it("starts from a main.tsx that exists, and leaves tests and declarations out", () => {
    const files = appFiles();
    expect(files).toContain("main.tsx");
    expect(files.some((f) => /\.test\.tsx?$/.test(f) || f.startsWith("test/") || f.endsWith(".d.ts"))).toBe(false);
  });

  it("reaches every non-test source file under src from main.tsx", () => {
    const graph = importGraph();
    const seen = reachable(graph, ["main.tsx"]);
    expect(appFiles().filter((f) => !seen.has(f)).sort()).toEqual([]);
  });
});
