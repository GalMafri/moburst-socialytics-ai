// @vitest-environment node
// Every function entry point type-checks under Deno. A function that does not
// type-check can still deploy, and then fails on the one request that reaches
// the bad line (eight functions failed the check on 11 Nov 2026, four of them
// live). The check runs wherever Deno is installed, which is every machine a
// release is prepared on; it is skipped where Deno is missing, and the CI
// runner is such a place today: the build job does not install Deno, and
// adding that step waits for a Git credential that may change workflow files
// (docs/superpowers/specs/2026-11-11-picture-service-design.md, "As released
// 16 Nov 2026").
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const hasDeno = spawnSync("deno", ["--version"], { stdio: "ignore" }).status === 0;
const entries = readdirSync(functionsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(functionsDir, d.name, "index.ts")))
  .map((d) => join(functionsDir, d.name, "index.ts"))
  .sort();

describe("edge function types", () => {
  it.skipIf(!hasDeno)("every function entry point passes deno check", () => {
    const r = spawnSync("deno", ["check", "--no-lock", "--quiet", ...entries], { encoding: "utf8" });
    expect(r.stderr, "deno check output").toBe("");
    expect(r.status).toBe(0);
  }, 300_000);
});
