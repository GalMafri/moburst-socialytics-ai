// A rewrite nobody asked for (the one client notes ask for, 2 Nov 2026) never
// touches a post a person approved, scheduled to Sprout, had a design
// requested or made for, or edited. runWeekRevise keeps every post
// calendar_post_worked() answers yes for (runWeek.test.ts covers the call
// and posts a person's own revision rewrote), so this reads the function's
// newest definition and checks it answers yes in each of those cases.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");
const definitions = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), "utf8").replace(/--[^\n]*/g, "") }))
  .flatMap(({ file, sql }) => [...sql.matchAll(/create or replace function public\.calendar_post_worked\([\s\S]*?\$\$([\s\S]*?)\$\$;/gi)].map((m) => ({ file, body: m[1].replace(/\s+/g, " ") })));
const newest = definitions.at(-1)!;

const TYPES = readFileSync(join(__dirname, "..", "integrations", "supabase", "types.ts"), "utf8");
const RUN_WEEK = readFileSync(join(__dirname, "..", "..", "supabase", "functions", "_shared", "calendar", "runWeek.ts"), "utf8");

describe("calendar_post_worked keeps a person's posts out of every rewrite nobody asked for", () => {
  it("is defined last by the client notes migration", () => {
    expect(newest.file).toBe("20261109100000_client_notes.sql");
  });

  it("answers yes for a post a person edited or moved (touched_at)", () => {
    expect(newest.body).toContain("p_touched is not null");
    expect(RUN_WEEK).toContain("p_touched: p.touched_at");
  });

  it("answers yes for a post with a saved copy edit, an approval or a finished design (all post_iterations rows of the post)", () => {
    // Approvals (is_approved) and design options live on the post's post_iterations rows.
    const iterations = TYPES.slice(TYPES.indexOf("      post_iterations: {"), TYPES.indexOf("      post_previews: {"));
    expect(iterations).toContain("is_approved: boolean");
    expect(iterations).toContain("calendar_post_key: string | null");
    expect(newest.body).toContain("exists (select 1 from post_iterations pi where pi.client_id = p_client and pi.calendar_post_key = p_key)");
  });

  it("answers yes for a post with a design requested", () => {
    expect(newest.body).toContain("exists (select 1 from design_requests dr where dr.client_id = p_client and dr.calendar_post_key = p_key and dr.status <> 'canceled')");
  });

  it("answers yes for a post scheduled to Sprout, by its key or by its copy", () => {
    expect(newest.body).toContain("exists (select 1 from scheduled_posts sp where sp.client_id = p_client and sp.calendar_post_key = p_key)");
    expect(newest.body).toMatch(/scheduled_posts sp where sp\.client_id = p_client and lower\(coalesce\(sp\.platform, ''\)\) = lower\(p_platform\) and left\(btrim\(coalesce\(sp\.post_content, ''\)\), 200\) = left\(btrim\(p_copy\), 200\)/);
  });

  it("is written only where nobody changed the copy or moved the post since it was read", () => {
    expect(RUN_WEEK).toMatch(/\.update\(patch\)\.eq\("id", r\.id\)\.eq\("copy", was\.copy \?\? ""\)\.is\("touched_at", null\)/);
  });
});
