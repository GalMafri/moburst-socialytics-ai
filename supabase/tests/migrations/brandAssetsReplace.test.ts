// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const dir = join(functionsDir, "..", "migrations");

/** Every `create policy` on storage.objects still in force after all migrations, by name. */
function storagePolicies(): Map<string, string> {
  const policies = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const m of sql.matchAll(/drop policy if exists "([^"]+)" on storage\.objects|create policy "([^"]+)" on storage\.objects([\s\S]*?);/gi)) {
      if (m[1]) policies.delete(m[1]);
      else policies.set(m[2], m[3]);
    }
  }
  return policies;
}

// QA 22 Nov 2026 (P06-4): Client Setup uploads brand books and design
// references with upsert, so choosing the same file again (or a quiet resend
// of an upload whose answer was lost) replaces the stored object. Storage
// checks an upsert against the UPDATE policies too (as the client-notes
// bucket's "Staff replace" policy says), and these buckets had none, so the
// same file could never be uploaded twice.
describe("brand asset buckets", () => {
  it.each(["brand-books", "design-references"])("%s lets staff replace a file they upload with upsert", (bucket) => {
    const forUpdate = [...storagePolicies().values()].filter((def) => /for\s+update/i.test(def) && def.includes(`'${bucket}'`));
    expect(forUpdate.length).toBeGreaterThan(0);
    for (const def of forUpdate) expect(def).toContain("is_moburst_staff");
  });
});
