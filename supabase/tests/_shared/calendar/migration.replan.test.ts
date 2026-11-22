// @vitest-environment node
// Copy sources (17 Nov 2026), the database half, read as text (it is applied
// by hand at release): a third scope for the one revision function, which is
// restated with the same arguments, body and grants, and two columns on
// sprout_profiles that record an account the app parked. Additive, and safe
// to run twice.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const read = (file: string) => readFileSync(join(root, "supabase", "migrations", file), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const FILE = "20261118110000_calendar_replan.sql";
const sql = read(FILE);
const before = read("20261019140000_weekly_calendar.sql");
const definition = (text: string) => {
  const m = /create or replace function public\.calendar_request_revision\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$;/i.exec(text);
  if (!m) throw new Error("calendar_request_revision is not defined");
  return { args: m[1], head: m[2].trim(), body: m[3].trim() };
};

describe(FILE, () => {
  it("drops nothing, adds only two columns and defines only the one function", () => {
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete from\b|\bupdate public\b|create table|create (unique )?index|create trigger|create policy/i);
    expect(sql.match(/create or replace function/gi)).toHaveLength(1);
    // Made again rather than added: running the file twice leaves one function.
    expect(sql).toMatch(/create or replace function public\.calendar_request_revision\(/);
    // The only changes to a table: two nullable columns, each added only if missing, with no default and no backfill.
    expect(sql.match(/\balter\b[^;]*;/gi)).toEqual([
      "alter table public.sprout_profiles add column if not exists parked_at timestamptz;",
      "alter table public.sprout_profiles add column if not exists parked_reason text;",
    ]);
    expect(sql).toContain("comment on column public.sprout_profiles.parked_at is");
    expect(sql).toContain("comment on column public.sprout_profiles.parked_reason is");
  });

  it("names the columns the app reads and writes for a parked account", () => {
    const steps = readFileSync(join(root, "supabase", "functions", "_shared", "lifecycle", "steps.ts"), "utf8");
    const run = readFileSync(join(root, "supabase", "functions", "_shared", "calendar", "runWeek.ts"), "utf8");
    // The accounts step reads its rows in parts with one column list (P39-05).
    expect(steps).toContain('const columns = "client_id, sprout_profile_id, network_type, is_active, profile_name, native_name, assigned_at, parked_at, parked_reason";');
    expect(steps).toContain('.from("sprout_profiles").select(columns)');
    expect(run).toContain('.from("sprout_profiles").select("parked_at").eq("client_id", clientId).eq("is_active", false).not("parked_at", "is", null)');
  });

  it("restates the function with the same four arguments, so no second version of it exists", () => {
    const now = definition(sql);
    const was = definition(before);
    expect(now.args).toBe("p_plan uuid, p_note text, p_user uuid default null, p_scope text default 'untouched'");
    expect(now.args).toBe(was.args);
    expect(now.head).toBe(was.head);
    expect(now.head).toBe("returns public.calendar_plans language plpgsql security definer set search_path = public as");
  });

  it("accepts the three scopes, and changes nothing else in the function", () => {
    const now = definition(sql).body;
    const was = definition(before).body;
    expect(now).toContain("if p_scope not in ('untouched', 'empty', 'replan') then raise exception 'Unknown revision scope %', p_scope; end if;");
    expect(was).toContain("if p_scope not in ('untouched', 'empty') then");
    expect(now.replace("('untouched', 'empty', 'replan')", "('untouched', 'empty')")).toBe(was);
    // What the rest still does: one revision at a time on a ready plan, a voice first for a client with none, and the job.
    expect(now).toContain("where id = p_plan and status = 'ready' and pending_revision is null");
    expect(now).toContain("raise exception 'This week is already being revised.'");
    expect(now).toMatch(/insert into scheduled_jobs \(kind, client_id, dedupe_key, priority, available_at\) values \('voice_profile'/);
    expect(now).toMatch(/insert into scheduled_jobs \(kind, client_id, occurrence, dedupe_key, priority, available_at\) values \('week_revise'/);
  });

  it("keeps the function for the service role only", () => {
    expect(sql).toContain("revoke all on function public.calendar_request_revision(uuid, text, uuid, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.calendar_request_revision(uuid, text, uuid, text) to service_role;");
    expect(sql.match(/\bgrant\b/gi)).toHaveLength(1);
    expect(before).toContain("revoke all on function public.calendar_request_revision(uuid, text, uuid, text) from public, anon, authenticated;");
  });

  it("is the only definition after the first until the strategy-only migration, which restates it with one refusal added", () => {
    // The daily filler and the notes' rewrite call the function; neither defines it.
    const filler = read("20261019190000_calendar_self_serve.sql");
    expect(filler).toContain("perform public.calendar_request_revision(v_plan.id, 'Write the posts that have no copy yet.', null, 'empty');");
    expect(filler).not.toMatch(/create or replace function public\.calendar_request_revision/i);
    const defining = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql") && /create or replace function public\.calendar_request_revision\(/i.test(read(f))).sort();
    // 20261118140000 restates it from this file with the refusal for a strategy-only client and nothing else
    // (supabase/tests/migrations/strategyOnlyClients.test.ts holds it to that).
    expect(defining).toEqual(["20261019140000_weekly_calendar.sql", FILE, "20261118140000_strategy_only_clients.sql"]);
  });
});
