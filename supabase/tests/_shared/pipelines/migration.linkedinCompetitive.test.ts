// @vitest-environment node
// 20261020130000_inhouse_linkedin_competitive.sql, read as text (it is not
// applied here; a PGlite run checked it applies twice and enforces what is
// below). It switches no engine, leaves the job kinds alone, lets an in-app
// LinkedIn source run point at the feed snapshot, and keeps a replay from
// counting as the shadow run the app engine waits for.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const code = (text: string) => text.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const raw = readFileSync(join(migrations, "20261020130000_inhouse_linkedin_competitive.sql"), "utf8");
const sql = code(raw);
const groundwork = code(readFileSync(join(migrations, "20261020110000_inhouse_groundwork.sql"), "utf8"));
const body = (text: string, fn: string) => {
  const start = text.indexOf(`create or replace function public.${fn}(`);
  expect(start, fn).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("$$", start);
  return text.slice(open + 2, text.indexOf("$$", open + 2)).trim();
};

describe("20261020130000_inhouse_linkedin_competitive.sql", () => {
  it("switches no engine and writes no client data", () => {
    expect(sql).not.toMatch(/insert into|update public\.|delete from/i);
    expect(sql).not.toContain("scheduled_jobs");
  });

  it("lets an app run of the LinkedIn source point at the feed snapshot, and nothing else change", () => {
    expect(sql).toContain("alter table public.report_pipeline_runs drop constraint if exists report_pipeline_runs_app_target;");
    expect(sql).toContain("check ( mode <> 'app' or (real_table in ('reports', 'competitive_reports') and real_id is not null) or (kind = 'linkedin_source' and real_table = 'rivaliq_snapshots' and real_ref is not null) );");
  });

  it("keeps the guard, and does not count a replay as the finished shadow run", () => {
    const before = body(groundwork, "report_engines_guard");
    const after = body(sql, "report_engines_guard");
    expect(after.replace(" and not (r.input ? 'replay')", "")).toBe(before);
    expect(after).toContain("r.mode = 'shadow' and r.status = 'done' and r.app_capable and not (r.input ? 'replay')");
  });

  it("says how to put Moburst on shadow and back, in its header only", () => {
    expect(raw).toContain("('linkedin_source', 'd00ce604-2bcc-455a-9826-f80250db75cf', 'shadow'");
    expect(raw).toContain("('competitive', 'd00ce604-2bcc-455a-9826-f80250db75cf', 'shadow'");
    expect(raw).not.toMatch(/[\u2013\u2014]/);
  });
});
