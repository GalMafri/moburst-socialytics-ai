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
import { pillarSectionKey, platformSectionKey } from "../../../functions/_shared/strategy/platforms";
import { FIXED_SECTIONS } from "../../../functions/_shared/strategy/write";

const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations", "20261110170000_strategy_v2.sql"), "utf8");
const sql = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const body = (fn: string) => {
  const at = sql.indexOf(`create or replace function public.${fn}(`);
  return sql.slice(at, sql.indexOf("end $$;", at));
};

describe("20261110170000_strategy_v2.sql", () => {
  it("is additive and safe to run again, and sorts after the migrations already applied", () => {
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b/i);
    // The only function it drops is save_as's earlier signature, which it replaces.
    expect([...sql.matchAll(/drop function [^;]+;/g)].map((m) => m[0])).toEqual(["drop function if exists public.strategy_section_save_as(uuid, uuid, text, text, text, text);"]);
    expect("20261110170000_strategy_v2.sql" > "20261110150000_claude_sync.sql").toBe(true);
    for (const m of sql.matchAll(/create table (\S+)/g)) expect(m[1]).toBe("if");
    for (const m of sql.matchAll(/alter table public\.\w+ add column (\S+)/g)) expect(m[1]).toBe("if");
    expect(sql).toContain("alter table public.content_strategy_edits add column if not exists value jsonb;");
    expect(sql).toContain("alter table public.content_strategies add column if not exists shape smallint not null default 1;");
    expect(sql).toContain("alter table public.content_strategies add column if not exists section_texts jsonb not null default '{}'::jsonb;");
  });

  it("has one save, for the page and for Claude: locked before it reads, writing text, fields and source together", () => {
    const save = body("strategy_section_save_as");
    expect(sql).toContain("create or replace function public.strategy_section_save_as(p_user uuid, p_client uuid, p_key text, p_text text, p_source text, p_expected text default null, p_value jsonb default null) returns jsonb language plpgsql security definer set search_path = public as $$");
    expect(sql).toContain("revoke all on function public.strategy_section_save_as(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.strategy_section_save_as(uuid, uuid, text, text, text, text, jsonb) to service_role;");
    // The guard first, then the locks, then the reads.
    expect(save.indexOf("is_oauth_session()")).toBeLessThan(save.indexOf("pg_advisory_xact_lock"));
    expect(save.indexOf("pg_advisory_xact_lock")).toBeLessThan(save.indexOf("for update"));
    expect(save.lastIndexOf("for update")).toBeLessThan(save.indexOf("select s.sections -> v_key"));
    expect(save).toContain("insert into public.content_strategy_edits as e (client_id, section_key, text, value, edited_by, editor_name, edited_at, source) values (p_client, v_key, v_text, v_value, p_user, coalesce(v_name, ''), now(), p_source)");
    expect(save).toContain("set text = excluded.text, value = excluded.value, edited_by = excluded.edited_by, editor_name = excluded.editor_name, edited_at = excluded.edited_at, source = excluded.source");
    // A save from Claude is plain text: it clears the fields, so the page shows its text; it never hands a section back.
    expect(save).toContain("if p_source = 'claude' then v_value := null; end if;");
    expect(save).toContain("A section saved from Claude is never handed back.");
    // The version is of the text the page shows: a person's, else the product's text, or its lines for a strategy written as fields.
    expect(save).toContain("case when jsonb_typeof(s.sections -> v_key) = 'string' then s.sections ->> v_key else s.section_texts ->> v_key end");
    expect(save).toContain("v_shown := coalesce(v_edit, v_product_text, ''); v_version := left(encode(sha256(convert_to(v_shown, 'UTF8')), 'hex'), 16);");
    expect(save).toContain("or (v_value is not null and v_value = v_product)");
  });

  it("saves from the page through that one function, for the signed-in person, from the app, for every key the writer produces", () => {
    expect(sql).toContain("create or replace function public.strategy_section_save(p_client uuid, p_key text, p_text text, p_value jsonb) returns jsonb language plpgsql security definer set search_path = public as $$");
    expect(body("strategy_section_save")).toContain("return public.strategy_section_save_as(auth.uid(), p_client, p_key, p_text, 'app', null, p_value);");
    expect(sql).toContain("return public.strategy_section_save_as(auth.uid(), p_client, p_key, p_text, 'app', null, null);");
    expect(sql).toContain("grant execute on function public.strategy_section_save(uuid, text, text, jsonb) to authenticated;");
    expect(sql).toContain("grant execute on function public.strategy_section_save(uuid, text, text) to authenticated;");
    const re = new RegExp(raw.match(/v_key !~ '([^']+)'/)![1]);
    for (const key of [...FIXED_SECTIONS, "not_now", "measures", pillarSectionKey("Q&A: rules, fees"), platformSectionKey("Instagram", "posting"), platformSectionKey("Twitter/X", "new")]) expect(re.test(key), key).toBe(true);
    // No write of a section anywhere but save_as.
    expect(sql.match(/insert into public\.content_strategy_edits/g)).toHaveLength(1);
  });

  it("refuses an OAuth session first in every function a person can call", () => {
    for (const fn of ["strategy_section_save_as", "strategy_section_save", "client_public_profile_set", "client_public_profile_remove", "strategy_deck_request"]) {
      if (fn === "strategy_section_save_as") { expect(body(fn)).toMatch(/^create or replace function [^$]+\$\$ declare [\s\S]*? begin if public\.is_oauth_session\(\) then raise exception/); continue; }
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
