// @vitest-environment node
// The Stories migration, read as text (the coordinator applies it by hand):
// additive, safe to run twice, one Story per post, grants explicit.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const sql = readFileSync(join(migrations, "20261109140000_stories.sql"), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

describe("20261109140000_stories.sql", () => {
  it("adds story_of to calendar posts, safely and only that", () => {
    expect(sql).toContain("alter table public.calendar_posts add column if not exists story_of text;");
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete from\b|\bupdate public\./i);
    expect(sql).not.toMatch(/create (or replace )?function/i);
    expect(sql).not.toMatch(/create table/i);
  });

  it("lets a post have one Story at most", () => {
    expect(sql).toContain("create unique index if not exists calendar_posts_story_of on public.calendar_posts (client_id, story_of) where story_of is not null;");
  });

  it("restates the table's grants", () => {
    expect(sql).toContain("revoke all on public.calendar_posts from anon;");
    expect(sql).toContain("grant select, insert, update, delete on public.calendar_posts to authenticated;");
    expect(sql).toContain("grant all on public.calendar_posts to service_role;");
  });
});
