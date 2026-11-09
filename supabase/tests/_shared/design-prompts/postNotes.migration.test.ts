// @vitest-environment node
// The notes-on-regenerate migration, read as text (the coordinator applies it
// by hand): additive, safe to run twice, grants explicit, no new table or
// function.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const sql = readFileSync(join(migrations, "20261110110000_post_notes_stories.sql"), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

describe("20261110110000_post_notes_stories.sql", () => {
  it("adds the note and what was learned from it to design requests, safely", () => {
    expect(sql).toContain("alter table public.design_requests add column if not exists note text;");
    expect(sql).toContain("alter table public.design_requests add column if not exists note_learned jsonb;");
    expect(sql).toContain("check (note is null or char_length(note) <= 500)");
    expect(sql).not.toMatch(/\btruncate\b|\bdelete from\b|\bupdate public\.|drop table|drop column/i);
    expect(sql).not.toMatch(/create (or replace )?function/i);
    expect(sql).not.toMatch(/create table/i);
  });

  it("says where a design rule came from", () => {
    expect(sql).toContain("alter table public.design_learnings add column if not exists source text not null default 'feedback';");
    expect(sql).toContain("alter table public.design_learnings add column if not exists evidence text;");
    expect(sql).toContain("check (source in ('feedback', 'regenerate_note'))");
  });

  it("lets a writing preference come from a rewrite note, keeping the sources it had", () => {
    expect(sql).toContain("check (source in ('copy_edit', 'revise_note', 'rewrite_note'))");
  });

  it("drops each constraint before adding it, so it runs twice", () => {
    for (const c of ["design_requests_note_length", "design_learnings_source_check", "brand_voice_learnings_source_check"]) {
      expect(sql.indexOf(`drop constraint if exists ${c};`), c).toBeGreaterThan(-1);
      expect(sql.indexOf(`drop constraint if exists ${c};`), c).toBeLessThan(sql.indexOf(`add constraint ${c}`));
    }
  });

  it("restates every table's grants, keeping design requests read-only to people", () => {
    expect(sql).toContain("revoke all on public.design_requests from anon, authenticated;");
    expect(sql).toContain("grant select on public.design_requests to authenticated;");
    expect(sql).not.toMatch(/grant [a-z, ]*(insert|update|delete)[a-z, ]* on public\.design_requests to authenticated/);
    for (const t of ["design_learnings", "brand_voice_learnings"]) {
      expect(sql).toContain(`revoke all on public.${t} from anon;`);
      expect(sql).toContain(`grant select, insert, update, delete on public.${t} to authenticated;`);
      expect(sql).toContain(`grant all on public.${t} to service_role;`);
    }
  });
});
