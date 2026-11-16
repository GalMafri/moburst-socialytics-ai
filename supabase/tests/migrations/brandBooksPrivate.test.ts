// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const dir = join(functionsDir, "..", "migrations");

// Brand books and strategy documents are a client's own files. They are read
// through the signed-in staff policy or by the service role, never by URL.
describe("the brand-books bucket", () => {
  it("is private once every migration has run", () => {
    const files = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort();
    // The last statement that sets the bucket's public flag wins.
    let isPublic: boolean | null = null;
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      for (const m of text.matchAll(/update\s+storage\.buckets\s+set\s+public\s*=\s*(true|false)\s+where\s+id\s*=\s*'brand-books'/gi)) isPublic = m[1].toLowerCase() === "true";
    }
    expect(isPublic).toBe(false);
  });
});
