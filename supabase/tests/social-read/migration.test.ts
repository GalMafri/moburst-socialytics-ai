// @vitest-environment node
// The social reads migration, read as text (the Lovable agent applies it):
// additive and safe to run twice, staff read and only the service role
// writes, the job kind is added to whatever kinds exist, and nothing queues
// a read on its own (step 2 of the plan starts the first read by hand).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = "20261126180000_social_reads.sql";
const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations", FILE), "utf8");
const sql = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const TABLES = ["social_profiles", "social_profile_snapshots", "social_posts", "social_post_metrics", "social_reads"];

describe(FILE, () => {
  it("is additive and safe to run twice", () => {
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\bdelete from\b/i);
    for (const m of sql.matchAll(/create (?:unique )?(?:table|index) (\S+)/g)) expect(m[1]).toBe("if");
    for (const t of TABLES) expect(sql).toContain(`create table if not exists public.${t} (`);
  });

  it("lets staff read and only the service role write", () => {
    expect(sql).toContain(`array['${TABLES.join("', '")}']`);
    expect(sql).toContain("revoke all on public.%I from anon, authenticated");
    expect(sql).toContain("grant select on public.%I to authenticated");
    expect(sql).not.toMatch(/grant (?:insert|update|delete)[^;]* to authenticated/);
    for (const t of TABLES) expect(sql).toMatch(new RegExp(`on public\\.${t} for select to authenticated using \\(`));
    expect((sql.match(/public\.is_moburst_staff\(\) and public\.can_access_client\(/g) ?? []).length).toBe(TABLES.length);
  });

  it("adds the social_read job kind to the kinds there are, and queues nothing", () => {
    expect(sql).toContain("array['social_read']");
    expect(sql).not.toMatch(/cron\.schedule|insert into public\.scheduled_jobs/);
  });
});
