// @vitest-environment node
// 20261110200000_dispatch_alert_due.sql, read as text (it is not applied
// here): release_ready_dispatches keeps both of today's releases word for
// word, and adds one that lets a waiting, sent dispatch out once its Slack
// alert is due, reading the time the dispatch writes and nothing else.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const read = (name: string) => readFileSync(join(migrations, name), "utf8");
/** The SQL without comments, whitespace folded. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const NAME = "20261110200000_dispatch_alert_due.sql";
const sql = code(read(NAME));
const groundwork = code(read("20261020110000_inhouse_groundwork.sql"));

const body = (text: string) => {
  const start = text.indexOf("create or replace function public.release_ready_dispatches(");
  expect(start).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("$$", start);
  return text.slice(open + 2, text.indexOf("$$", open + 2)).trim();
};
const updates = (b: string) => b.split("update public.scheduled_jobs j").slice(1).map((u) => u.slice(0, u.indexOf("get diagnostics")).trim());

describe(NAME, () => {
  it("is the latest definition of release_ready_dispatches", () => {
    const later = readdirSync(migrations).filter((f) => f > NAME && f.endsWith(".sql"));
    for (const f of later) expect(read(f), f).not.toContain("function public.release_ready_dispatches");
  });

  it("keeps the held-social and sent-report releases word for word", () => {
    const before = updates(body(groundwork));
    const after = updates(body(sql));
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(3);
    expect(after.slice(0, 2)).toEqual(before);
  });

  it("lets out a waiting, sent dispatch whose alert is due and not yet posted", () => {
    const alert = updates(body(sql))[2];
    expect(alert).toContain("set status = 'queued', available_at = now(), lease_until = null, updated_at = now()");
    expect(alert).toContain("where j.kind = 'dispatch' and j.status = 'waiting' and j.phase = 'sent'");
    expect(alert).toContain("and j.result ->> 'alerted_at' is null");
    // The time is cast only when it has the form the dispatch writes.
    expect(alert).toContain("case when coalesce(j.result ->> 'alert_due_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$' then (j.result ->> 'alert_due_at')::timestamptz <= now() else false end");
    expect(body(sql)).toContain("return v_held + v_sent + v_alert;");
  });

  it("reads the form the dispatch writes (toISOString)", () => {
    const form = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    expect(new Date("2026-11-08T07:20:00Z").toISOString()).toMatch(form);
    expect("tomorrow").not.toMatch(form);
  });

  it("writes only scheduled_jobs and schedules nothing", () => {
    expect(sql).not.toMatch(/(insert into|update|delete from) public\.(?!scheduled_jobs\b)\w+/);
    expect(sql).not.toContain("cron.schedule");
    expect(sql).not.toContain("net.http_post");
  });
});
