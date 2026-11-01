// @vitest-environment node
// The Trends migrations, read as text (their behavior on Postgres is checked
// when Task 8 applies them). Guards the mistakes a dry run would not show.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const code = (name: string) => readFileSync(join(migrations, name), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const job = code("20261029100100_trend_refresh_job.sql");

describe("20261029100100_trend_refresh_job.sql", () => {
  it("names the enqueue function's output columns apart from every column its statements use", () => {
    // A PL/pgSQL output column is also a variable: one named like a column the
    // insert's on conflict target uses fails as ambiguous on every real run
    // (checked on Postgres 1 Nov 2026), while a dry run never reaches the insert.
    const out = job.match(/returns table \(([^)]*)\)/)![1].split(",").map((c) => c.trim().split(" ")[0]);
    for (const column of ["client_id", "dedupe_key", "kind", "priority", "available_at", "status", "week_start", "id"]) expect(out).not.toContain(column);
  });

  it("queues a week again whose run stopped, at most three runs a week, and closes a week that used them up", () => {
    expect(job).toMatch(/r\.status = 'running'/);
    expect(job).toMatch(/< 3/);
    expect(job).toMatch(/update public\.trend_weeks set status = 'partial'/);
  });
});
