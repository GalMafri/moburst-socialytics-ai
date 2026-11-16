// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const dir = join(functionsDir, "..", "migrations");
const NAMES = ["Read generated media for accessible clients", "Upload generated media for accessible clients", "Update generated media for accessible clients"];

/** The text of a policy's newest `create policy`, up to its closing semicolon. */
function newestDefinition(name: string): string {
  let found = "";
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    const re = new RegExp(`create policy "${name}"[\\s\\S]*?;`, "g");
    for (const m of sql.matchAll(re)) found = m[0];
  }
  return found;
}

describe("generated-media policies", () => {
  it.each(NAMES)("%s no longer names the post-thumbnails folder", (name) => {
    const def = newestDefinition(name);
    expect(def).not.toBe("");
    expect(def).not.toContain("post-thumbnails");
  });

  it.each(NAMES)("%s still scopes a client folder to its client and the rest to staff", (name) => {
    const def = newestDefinition(name);
    expect(def).toContain("can_access_client");
    expect(def).toContain("is_moburst_staff");
  });
});
