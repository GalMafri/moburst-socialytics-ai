// @vitest-environment node
// The Trends migrations, read as text (their behavior on Postgres is checked
// when Task 8 applies them). Guards the mistakes a dry run would not show.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The weekly job's migration waits in supabase/pending until Lital reviews the trial.
const pending = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "pending");
const code = (name: string) => readFileSync(join(pending, name), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const job = code("20261029100100_trend_refresh_job.sql");

describe("20261029100100_trend_refresh_job.sql", () => {
  it("names the enqueue function's output columns apart from every column its statements use", () => {
    // A PL/pgSQL output column is also a variable: one named like a column the
    // insert's on conflict target uses fails as ambiguous on every real run
    // (checked on Postgres 1 Nov 2026), while a dry run never reaches the insert.
    const out = job.match(/returns table \(([^)]*)\)/)![1].split(",").map((c) => c.trim().split(" ")[0]);
    for (const column of ["client_id", "dedupe_key", "kind", "priority", "available_at", "status", "week_start", "id"]) expect(out).not.toContain(column);
  });

  it("queues a week again whose run stopped, at most three stopped runs a week, and closes a week that used them up", () => {
    expect(job).toMatch(/r\.status = 'running'/);
    // Only stopped runs count: a replay or a finished run never uses up a week's tries.
    expect(job).toContain("(select count(*) from public.report_pipeline_runs r where r.real_id = w.id and r.status = 'stopped') < 3");
    expect(job).toContain("(select count(*) from public.report_pipeline_runs r where r.real_id = trend_weeks.id and r.status = 'stopped') >= 3");
    expect(job).toMatch(/update public\.trend_weeks set status = 'partial'/);
  });
});

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const hardening = readFileSync(join(migrationsDir, "20261101120000_trends_hardening.sql"), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

describe("20261101120000_trends_hardening.sql", () => {
  it("queues Trends steps after real report runs (25) and their shadows (60)", () => {
    expect(hardening).toContain("case when p_kind = 'trends' then 80 when p_mode = 'app' then 25 else 60 end");
  });

  it("refuses every write to the trend tables from client and anonymous users", () => {
    expect(hardening).toContain("revoke insert, update, delete, truncate on public.trend_profiles, public.trend_terms, public.trend_weeks, public.trend_posts, public.trend_themes from anon, authenticated");
    expect(hardening).toContain("revoke all on public.trend_profiles, public.trend_terms, public.trend_weeks, public.trend_posts, public.trend_themes from anon");
  });

  it("hides dismissed themes from client users", () => {
    expect(hardening).toContain("using (public.is_moburst_staff() or (dismissed_at is null and public.is_client_member(client_id)))");
  });
});

