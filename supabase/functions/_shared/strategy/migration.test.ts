// @vitest-environment node
// The content strategy migration, read as text (the coordinator applies it by
// hand). Guards what a dry run would not show: who can read and write, that
// the save function accepts every key the writer produces, and the trigger.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pillarSectionKey, platformSectionKey } from "./platforms";
import { FIXED_SECTIONS } from "./write";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const raw = readFileSync(join(migrations, "20261108120000_content_strategy.sql"), "utf8");
const sql = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

describe("20261108120000_content_strategy.sql", () => {
  it("adds both tables safely, with row level security on each", () => {
    expect(sql).toContain("create table if not exists public.content_strategies (");
    expect(sql).toContain("create table if not exists public.content_strategy_edits (");
    expect(sql).toContain("alter table public.content_strategies enable row level security;");
    expect(sql).toContain("alter table public.content_strategy_edits enable row level security;");
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b/i);
  });

  it("lets only staff who can access the client read either table, and nobody but the service role write them", () => {
    for (const table of ["content_strategies", "content_strategy_edits"]) {
      expect(sql).toMatch(new RegExp(`create policy "[^"]+" on public\\.${table} for select to authenticated using \\(public\\.is_moburst_staff\\(\\) and public\\.can_access_client\\(client_id\\)\\);`));
    }
    expect(sql).not.toMatch(/for (insert|update|delete|all) to authenticated/);
    expect(sql).toContain("revoke all on public.content_strategies, public.content_strategy_edits from anon, authenticated;");
    expect(sql).toContain("grant select on public.content_strategies, public.content_strategy_edits to authenticated;");
  });

  it("saves through a security definer function for staff with access, with its search path set and its grants explicit", () => {
    expect(sql).toContain("create or replace function public.strategy_section_save(p_client uuid, p_key text, p_text text) returns jsonb language plpgsql security definer set search_path = public as $$");
    expect(sql).toContain("if not (public.is_moburst_staff() and public.can_access_client(p_client)) then");
    expect(sql).toContain("revoke all on function public.strategy_section_save(uuid, text, text) from public, anon;");
    expect(sql).toContain("grant execute on function public.strategy_section_save(uuid, text, text) to authenticated;");
  });

  it("accepts every section key the writer produces, and no other", () => {
    const pattern = raw.match(/v_key !~ '([^']+)'/)![1];
    const re = new RegExp(pattern);
    for (const key of [...FIXED_SECTIONS, "not_now", pillarSectionKey("Beer League Truths"), pillarSectionKey("Q&A: rules, fees"), platformSectionKey("Instagram", "posting"), platformSectionKey("Twitter/X", "new"), platformSectionKey("YouTube", "new")]) {
      expect(re.test(key), key).toBe(true);
    }
    for (const key of ["", "pillar:", "platform:instagram:not_now", "platform:Instagram:posting", "notes"]) expect(re.test(key), key).toBe(false);
  });

  it("looks at the client again when its posting rhythm changes, and keeps every column the trigger watched", () => {
    expect(sql).toContain("or new.posting_rhythm is distinct from old.posting_rhythm then");
    expect(sql).toContain("create trigger clients_lifecycle after insert or update of website_url, name, archived_at, brief_text, brief_file_id, strategy_doc_file_path, competitor_seed_notes, logo_url, brand_identity, timezone, field_sources, posting_rhythm on public.clients");
  });
});
