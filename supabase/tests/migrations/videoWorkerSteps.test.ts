// @vitest-environment node
// 20261111130100_video_worker_steps.sql, applied twice to PGlite over a stub
// of pg_cron: the video worker's minute timer runs while a video job waits at
// any of its steps, and at none from before the video update.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";
import { VIDEO_STEPS } from "../../functions/_shared/video/stepNames";
import { OLD_STEPS } from "../../functions/_shared/video/clip";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261111130100_video_worker_steps.sql"), "utf8");

// pg_cron as far as this migration needs it: the job table and its two calls.
const SETUP = `
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql as $$
  with gone as (delete from cron.job where jobname = p_name returning 1) select exists (select 1 from gone) $$;
select cron.schedule('video-worker', '* * * * *', 'select 1');
`;

let db: PGlite;
let command = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
  const { rows } = await db.query<{ command: string; schedule: string; n: number }>("select command, schedule, (select count(*)::int from cron.job) as n from cron.job where jobname = 'video-worker'");
  expect(rows).toHaveLength(1);
  expect(rows[0].n).toBe(1);
  expect(rows[0].schedule).toBe("* * * * *");
  command = rows[0].command;
}, 30_000);
afterAll(async () => { await db.close(); });

const stepList = (text: string): string[] => {
  const m = /step in \(([^)]*)\)/.exec(text);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
};

describe("the video worker's timer", () => {
  it("runs for video jobs at every step the video worker owns", () => {
    expect(command).toContain("/functions/v1/video-worker");
    expect(command).toContain("input->>'kind' = 'video'");
    expect(stepList(command)).toEqual([...VIDEO_STEPS]);
  });
  it("names no step from before the video update", () => {
    for (const old of OLD_STEPS) expect(stepList(migration)).not.toContain(old);
    for (const old of OLD_STEPS) expect(migration).not.toMatch(new RegExp(`'${old}'`));
  });
});
