// @vitest-environment node
// supabase/config.toml and the function folders agree: every folder has an
// entry (a function with no entry deploys with JWT verification on, and one
// that checks its caller itself then answers 401 to every call), and every
// entry has a folder (an entry for a deleted function is dead config).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const folders = readdirSync(functionsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "_shared").map((d) => d.name).sort();
const config = readFileSync(join(functionsDir, "..", "config.toml"), "utf8");
const entries = [...config.matchAll(/^\[functions\.([a-z0-9-]+)\]/gm)].map((m) => m[1]).sort();

describe("config.toml function entries", () => {
  it("has an entry for every function folder", () => {
    expect(folders.filter((f) => !entries.includes(f))).toEqual([]);
  });
  it("has a folder for every entry", () => {
    expect(entries.filter((e) => !folders.includes(e))).toEqual([]);
  });
  it("lists each function once", () => {
    expect(entries.length).toBe(new Set(entries).size);
  });
});
