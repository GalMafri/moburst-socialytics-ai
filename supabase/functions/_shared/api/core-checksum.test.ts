import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The API core is copied verbatim between the Moburst tools (AdVisor is the
 * source). CORE.sha256 is written by scripts/sync-api-core.sh in every copy;
 * this test fails when a copy was edited in place instead of being synced.
 */
describe("api core", () => {
  it("matches the synced checksum", () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "core-checksum.test.ts").sort();
    const hash = createHash("sha256");
    for (const f of files) hash.update(readFileSync(join(dir, f)));
    expect(hash.digest("hex")).toBe(readFileSync(join(dir, "CORE.sha256"), "utf8").trim());
  });
});
