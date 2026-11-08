// @vitest-environment node
// Every status a sent post is recorded with (send.ts) is one the
// scheduled_posts table takes, as the migrations leave its status rule.
// Until 20261110190000_sent_now_status.sql the rule had no 'sent_now', so
// each "send now" reached Sprout and its row was refused (8 Nov 2026).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SENT_STATUSES } from "./send";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/** The statuses in the last scheduled_posts_status_check the migrations add. */
function allowedStatuses(): string[] {
  let last: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    const rule = /add\s+constraint\s+scheduled_posts_status_check\s+check\s*\(([\s\S]*?)\)\s*\)\s*;/gi;
    for (let m = rule.exec(sql); m; m = rule.exec(sql)) last = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return last;
}

describe("scheduled_posts status rule", () => {
  it("takes every status a sent post is recorded with", () => {
    const allowed = allowedStatuses();
    expect(allowed.length).toBeGreaterThan(0);
    for (const status of Object.values(SENT_STATUSES)) expect(allowed).toContain(status);
  });
});
