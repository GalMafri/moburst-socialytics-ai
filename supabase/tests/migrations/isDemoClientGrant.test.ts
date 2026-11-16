// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const dir = join(functionsDir, "..", "migrations");

describe("is_demo_client", () => {
  it("is not executable by an unsigned caller", () => {
    const all = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(all).toMatch(/revoke execute on function public\.is_demo_client\(uuid\) from anon/i);
  });
});
