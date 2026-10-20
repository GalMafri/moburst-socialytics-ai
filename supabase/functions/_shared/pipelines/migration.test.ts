// @vitest-environment node
// The groundwork migration, read as text (it is not applied here): every
// switch starts on n8n, shadow is per client only, app is guarded, the main
// lease and today's release rule are unchanged apart from leaving pipeline
// steps to their lane, and nothing writes a table a screen reads.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const read = (name: string) => readFileSync(join(migrations, name), "utf8");
/** The SQL without comments, whitespace folded. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const sql = code(read("20261020110000_inhouse_groundwork.sql"));
const original = code(read("20261006150000_scheduled_report_queue.sql"));
const recovery = code(read("20261019200000_pipeline_recovery.sql"));

/** The text of a function's body ($$ ... $$) in folded SQL. */
const body = (text: string, fn: string) => {
  const start = text.indexOf(`create or replace function public.${fn}(`);
  expect(start, fn).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("$$", start);
  return text.slice(open + 2, text.indexOf("$$", open + 2)).trim();
};

describe("20261020110000_inhouse_groundwork.sql", () => {
  it("starts every kind on n8n and switches no client to anything", () => {
    expect(sql).toContain("insert into public.report_engines (kind, engine, note) values ('social', 'n8n', 'Monthly social report: n8n SZbRTV7yOdXTNHHf'), ('competitive', 'n8n', 'Competitive analysis: n8n EBiAwSay3H2R8krv'), ('linkedin_source', 'n8n', 'Verified LinkedIn Source: n8n xm3ZFPjysyQCkWsc') on conflict do nothing;");
    expect(sql.match(/insert into public\.report_engines/g)).toHaveLength(1);
    expect(sql).toContain("engine text not null default 'n8n'");
  });

  it("allows shadow only per client, and refuses app until an app-capable pipeline finished a shadow run", () => {
    expect(sql).toContain("constraint report_engines_shadow_per_client check (engine <> 'shadow' or client_id is not null)");
    const guard = body(sql, "report_engines_guard");
    expect(guard).toContain("new.engine = 'app'");
    expect(guard).toContain("r.mode = 'shadow' and r.status = 'done' and r.app_capable");
    expect(guard).toContain("raise exception");
  });

  it("keeps the main lease as it was, except that pipeline steps go to their own lane", () => {
    const before = body(original, "scheduled_jobs_lease");
    const after = body(sql, "scheduled_jobs_lease");
    expect(after).toContain("where kind <> 'report_pipeline' and ((status = 'queued' and available_at <= now()) or (status = 'running' and lease_until < now()))");
    expect(after.replace("where kind <> 'report_pipeline' and ((status = 'queued' and available_at <= now()) or (status = 'running' and lease_until < now()))", "where (status = 'queued' and available_at <= now()) or (status = 'running' and lease_until < now())")).toBe(before);
  });

  it("caps the pipeline lane across every worker, one lease at a time", () => {
    const lane = body(sql, "scheduled_jobs_lease_pipelines");
    expect(lane).toContain("pg_advisory_xact_lock");
    expect(lane).toContain("p_max_running - count(*)");
    expect(lane).toContain("where kind = 'report_pipeline'");
    expect(lane).toContain("for update skip locked");
  });

  it("releases n8n dispatches by exactly today's rule", () => {
    const before = body(recovery, "release_ready_dispatches");
    const after = body(sql, "release_ready_dispatches");
    // The held-social release is unchanged.
    const held = (b: string) => b.slice(b.indexOf("update public.scheduled_jobs j"), b.indexOf("get diagnostics v_held"));
    expect(held(after)).toBe(held(before));
    // Today's sent rule is the else branch, word for word.
    const todays = "not exists (select 1 from public.reports r where r.id = j.report_id and r.status in ('running', 'pending') and r.created_at > now() - interval '90 minutes') and not exists (select 1 from public.competitive_reports c where c.id = j.report_id and c.status in ('running', 'pending') and c.created_at > now() - interval '90 minutes')";
    expect(before).toContain(todays);
    expect(after).toContain(`else ${todays} end;`);
    expect(after).toContain("when coalesce(j.result ->> 'engine', '') = 'app' then");
  });

  it("adds the report_pipeline kind to whatever kinds the constraint already allows", () => {
    expect(sql).toContain("pg_get_constraintdef(oid)");
    for (const kind of ["feed_refresh", "dispatch", "week_plan", "week_revise", "voice_profile", "lifecycle", "lifecycle_step", "report_pipeline"]) {
      expect(sql).toContain(`'${kind}'`);
    }
  });

  it("writes no table a screen reads, and schedules nothing", () => {
    for (const table of ["reports", "competitive_reports", "rivaliq_snapshots", "calendar_plans", "calendar_posts", "report_schedules", "clients"]) {
      expect(sql, table).not.toMatch(new RegExp(`(insert into|update|delete from) public\\.${table}\\b`));
    }
    expect(sql).not.toContain("cron.schedule");
    expect(sql).not.toContain("net.http_post");
  });

  it("keeps every new table to the service role", () => {
    for (const table of ["report_engines", "report_pipeline_runs", "report_pipeline_steps", "shadow_social_reports", "shadow_competitive_reports", "shadow_linkedin_sources", "pipeline_payloads"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).not.toMatch(new RegExp(`create policy [^;]* on public\\.${table}\\b`));
    }
    expect(sql).toContain("('pipeline-payloads', 'pipeline-payloads', false)");
  });

  it("links a shadow to its real run without a foreign key, so dropping a report that did not finish is never blocked", () => {
    expect(sql).toContain("real_id uuid,");
    expect(sql).not.toMatch(/references public\.(reports|competitive_reports|rivaliq_snapshots)\b/);
  });
});
