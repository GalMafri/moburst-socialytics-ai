// @vitest-environment node
// Every database function the app calls is written in a migration, so a fresh
// database has it. Six admin Usage functions were live and in no migration.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migrations = join(functionsDir, "..", "migrations");
const srcDir = join(functionsDir, "..", "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === "test" || n === "tests") return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && !p.includes("integrations/supabase/types") ? [p] : [];
  });
}

const sources = [...walk(srcDir), ...walk(functionsDir)];
const called = new Set<string>();
for (const f of sources) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/\.rpc(?:<[^>]*>)?\(\s*["']([a-z_0-9]+)["']/g)) called.add(m[1]);
}
// The Usage page names its readers in a type, then calls rpc(fn).
for (const m of readFileSync(join(srcDir, "pages", "Usage.tsx"), "utf8").matchAll(/"(get_[a-z_]+)"/g)) called.add(m[1]);

const sql = readdirSync(migrations).filter((x) => x.endsWith(".sql")).map((f) => readFileSync(join(migrations, f), "utf8")).join("\n");
const declared = new Set([...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi)].map((m) => m[1].toLowerCase()));

describe("database functions the app calls", () => {
  it("finds the calls it is meant to check", () => {
    expect(called.size).toBeGreaterThan(30);
    expect(called.has("get_user_detail")).toBe(true);
  });

  it("are each declared by a migration", () => {
    expect([...called].filter((n) => !declared.has(n)).sort()).toEqual([]);
  });

  it("the usage functions have no dash as an empty value", () => {
    const m = readFileSync(join(migrations, "20261113100200_usage_admin_functions.sql"), "utf8");
    expect(m).not.toMatch(/[—–]/);
  });
});
