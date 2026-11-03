// @vitest-environment node
// The strategy v2 migration, read as text (the coordinator applies it by
// hand). Guards what a dry run would not show: the save takes every section
// key in its fields, the new tables are staff-read and OAuth-proof, every
// function a person can call refuses an OAuth session first, the Google token
// is reachable only by the service role, and the deck job kind exists.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pillarSectionKey, platformSectionKey } from "./platforms";
import { FIXED_SECTIONS } from "./write";

const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations", "20261110130000_strategy_v2.sql"), "utf8");
const sql = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const body = (fn: string) => {
  const at = sql.indexOf(`create or replace function public.${fn}(`);
  return sql.slice(at, sql.indexOf("end $$;", at));
};

describe("20261110130000_strategy_v2.sql", () => {
  it("is additive and safe to run again", () => {
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\bdrop function\b/i);
    for (const m of sql.matchAll(/create table (\S+)/g)) expect(m[1]).toBe("if");
    for (const m of sql.matchAll(/alter table public\.\w+ add column (\S+)/g)) expect(m[1]).toBe("if");
    expect(sql).toContain("alter table public.content_strategy_edits add column if not exists value jsonb;");
    expect(sql).toContain("alter table public.content_strategies add column if not exists shape smallint not null default 1;");
  });

  it("keeps the 2 Nov save and adds one that takes a section's fields, for every key the writer produces", () => {
    expect(sql).toContain("create or replace function public.strategy_section_save(p_client uuid, p_key text, p_text text, p_value jsonb) returns jsonb language plpgsql security definer set search_path = public as $$");
    expect(sql).toContain("grant execute on function public.strategy_section_save(uuid, text, text, jsonb) to authenticated;");
    const re = new RegExp(raw.match(/v_key !~ '([^']+)'/)![1]);
    for (const key of [...FIXED_SECTIONS, "not_now", "measures", pillarSectionKey("Q&A: rules, fees"), platformSectionKey("Instagram", "posting"), platformSectionKey("Twitter/X", "new")]) expect(re.test(key), key).toBe(true);
    // Handing back: empty with no fields, or the product's own fields.
    expect(body("strategy_section_save")).toContain("or (v_value is not null and v_value = v_product)");
  });

  it("refuses an OAuth session first in every function a person can call", () => {
    for (const fn of ["strategy_section_save", "client_public_profile_set", "client_public_profile_remove", "strategy_deck_request"]) {
      const b = body(fn);
      expect(b, fn).toMatch(/begin if public\.is_oauth_session\(\) then raise exception 'Connected apps can read Socialytics but cannot change it\.' using errcode = '42501'; end if; if not \(public\.is_moburst_staff\(\) and public\.can_access_client\(p_client\)\) then/);
    }
  });

  it("lets staff who can access the client read the new tables, and gives each the three OAuth policies", () => {
    for (const table of ["client_public_profiles", "content_strategy_exports"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toMatch(new RegExp(`create policy "[^"]+" on public\\.${table} for select to authenticated using \\(public\\.is_moburst_staff\\(\\) and public\\.can_access_client\\(client_id\\)\\);`));
    }
    for (const table of ["client_public_profiles", "content_strategy_exports", "google_connection"]) {
      for (const op of ["insert", "update", "delete"]) expect(sql).toContain(`create policy "OAuth sessions cannot ${op}" on public.${table} as restrictive for ${op} to authenticated`);
    }
    expect(sql).not.toMatch(/for (insert|update|delete|all) to authenticated using \(public\.is_moburst/);
  });

  it("keeps a person's public profile and never brings back one a person removed", () => {
    expect(body("client_public_profile_set")).toContain("'person'");
    expect(body("client_public_profile_remove")).toContain("set source = 'removed'");
    expect(sql).toContain("source text not null check (source in ('rivaliq', 'website', 'person', 'removed'))");
  });

  it("keeps the Google token in Vault, reachable only by the service role, and the connection table from everyone else", () => {
    for (const fn of ["google_token_save(text)", "google_token_read()", "google_token_clear()"]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    for (const fn of ["google_token_save", "google_token_read", "google_token_clear"]) expect(body(fn)).toContain("if coalesce(auth.role(), '') <> 'service_role' then raise exception");
    expect(body("google_token_read")).toContain("from vault.decrypted_secrets where name = 'socialytics_google_refresh_token'");
    expect(sql).toContain("revoke all on public.google_connection from public, anon, authenticated;");
    expect(sql).not.toMatch(/refresh_token text/);
  });

  it("queues a deck as a strategy_deck job, one under way per client", () => {
    expect(sql).toContain("array['strategy_deck']");
    expect(body("strategy_deck_request")).toContain("insert into public.scheduled_jobs (kind, client_id, payload, dedupe_key, priority, available_at) values ('strategy_deck', p_client, jsonb_build_object('export_id', v_row.id)");
    expect(sql).toContain("create unique index if not exists content_strategy_exports_one_open on public.content_strategy_exports (client_id) where status in ('queued', 'making');");
    expect(sql).toContain("insert into storage.buckets (id, name, public) values ('strategy-decks', 'strategy-decks', false)");
  });
});
