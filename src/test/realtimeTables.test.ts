// Every realtime subscription in src names a table the live database
// publishes to supabase_realtime. A subscription to any other table never
// delivers (post_iterations was one: its publication migration was never
// applied, and the screens refetch on activity instead).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The tables in the supabase_realtime publication on the live database. */
const PUBLISHED = ["reports", "media_jobs", "competitor_handles", "competitive_reports"];
const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" || name === "integrations" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("realtime subscriptions", () => {
  it("name only tables in the published list", () => {
    const subscribed: Array<{ file: string; table: string }> = [];
    for (const file of files(src)) {
      const text = readFileSync(file, "utf8");
      for (const call of text.matchAll(/["']postgres_changes["'][\s\S]*?\{([\s\S]*?)\}/g)) {
        const table = call[1].match(/table:\s*["'`]([a-z_]+)["'`]/)?.[1];
        subscribed.push({ file: file.slice(src.length + 1), table: table ?? "(none named)" });
      }
    }
    expect(subscribed.length).toBeGreaterThan(0);
    expect(subscribed.filter((s) => !PUBLISHED.includes(s.table))).toEqual([]);
  });
});
