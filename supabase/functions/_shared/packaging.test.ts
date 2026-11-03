// @vitest-environment node
// What a deploy packages: a function's own folder and _shared, never another
// function's folder (mcp failed to deploy on 2 Nov 2026 because it imported
// ../api/store.ts). For every function, every local file its index.ts reaches
// (imports and re-exports, type-only and dynamic ones included) must exist
// and sit in that function's folder or in _shared.
//
// The graph is read with TypeScript's preProcessFile, so the check needs no
// Deno and runs in CI. Where Deno is installed, the mcp and api graphs are
// also read with `deno info --json` and must be exactly the same files, so the
// reader cannot drift from what Deno resolves.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const functionsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const functions = readdirSync(functionsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "_shared").map((d) => d.name).sort();
const rel = (file: string) => relative(functionsDir, file).split(sep).join("/");

/** Every local file reachable from a function's index.ts, and the relative imports that resolve to nothing. */
function localGraph(fn: string): { files: string[]; missing: string[] } {
  const seen = new Set<string>();
  const missing: string[] = [];
  const queue = [join(functionsDir, fn, "index.ts")];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const { importedFiles } = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
    for (const { fileName } of importedFiles) {
      if (!fileName.startsWith("./") && !fileName.startsWith("../")) continue; // URLs, npm:, jsr: and node: are fetched, not packaged
      const target = resolve(dirname(file), fileName);
      if (existsSync(target)) queue.push(target);
      else missing.push(`${rel(file)} -> ${fileName}`);
    }
  }
  return { files: [...seen].map(rel).sort(), missing };
}

const outside = (fn: string, files: string[]) => files.filter((f) => !f.startsWith(`${fn}/`) && !f.startsWith("_shared/"));

// A deploy uploads the function's folder and all of _shared, test files
// included, and refuses an upload over about 4.5 MB (run-scheduled-jobs, mcp
// and api at 4.6 MB on 3 Nov 2026, from 1.1 MB of fixtures in _shared). Test
// data lives in supabase/fixtures; the budget leaves room under the limit.
const UPLOAD_BUDGET = 4_000_000;
function bytesUnder(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce((sum, d) => {
    const path = join(dir, d.name);
    return sum + (d.isDirectory() ? bytesUnder(path) : d.isFile() ? statSync(path).size : 0);
  }, 0);
}
function fixtureFolders(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
    const path = join(dir, d.name);
    return d.name === "fixtures" ? [rel(path)] : fixtureFolders(path);
  });
}

describe("deploy packaging", () => {
  it("covers every function folder", () => {
    expect(functions.length).toBeGreaterThan(50);
    expect(functions).toEqual(expect.arrayContaining(["api", "mcp"]));
    for (const fn of functions) expect(existsSync(join(functionsDir, fn, "index.ts")), fn).toBe(true);
  });

  it.each(functions)("%s imports only its own folder and _shared, and every import resolves", (fn) => {
    const { files, missing } = localGraph(fn);
    expect(missing).toEqual([]);
    expect(outside(fn, files)).toEqual([]);
  });

  it("keeps test data out of the deployed folders", () => {
    expect(fixtureFolders(functionsDir)).toEqual([]);
  });

  it("keeps every function's upload under the deploy limit", () => {
    const shared = bytesUnder(join(functionsDir, "_shared"));
    const over = functions.map((fn) => ({ fn, bytes: shared + bytesUnder(join(functionsDir, fn)) })).filter((u) => u.bytes > UPLOAD_BUDGET);
    expect(over).toEqual([]);
  });

  const deno = spawnSync("deno", ["--version"], { encoding: "utf8" }).status === 0;
  it.skipIf(!deno).each(["mcp", "api"])("%s: deno info reads the same local files", (fn) => {
    const out = spawnSync("deno", ["info", "--json", "--no-lock", "--node-modules-dir=none", "--allow-import", join(functionsDir, fn, "index.ts")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    expect(out.status, out.stderr).toBe(0);
    const graph = JSON.parse(out.stdout) as { modules: Array<{ specifier: string; error?: string }> };
    const local = graph.modules.filter((m) => m.specifier.startsWith("file://"));
    expect(local.filter((m) => m.error).map((m) => `${m.specifier}: ${m.error}`)).toEqual([]);
    const files = local.map((m) => rel(fileURLToPath(m.specifier))).sort();
    expect(outside(fn, files)).toEqual([]);
    expect(files).toEqual(localGraph(fn).files);
  }, 150_000);
});
