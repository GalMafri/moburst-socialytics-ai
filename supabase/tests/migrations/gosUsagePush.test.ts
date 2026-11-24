// @vitest-environment node
// The gOS usage push's database side: test clients are left out (gos_events
// does not filter them in Socialytics), tool-open is never selected, what was
// answered is not read again, and pg_cron calls the function every 15 minutes
// with the secret the other scheduled functions use.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const sql = readFileSync(join(functionsDir, "..", "migrations", "20261124150000_gos_usage_push.sql"), "utf8");
const pending = /create or replace function public\.gos_usage_pending[\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";

describe("gos_usage_pending", () => {
  it("leaves out clients marked exclude_from_reporting", () => {
    expect(pending).toMatch(/not coalesce\(c\.exclude_from_reporting, false\)/);
  });
  it("selects only the three events a tool sends, never tool-open", () => {
    expect(pending).toMatch(/g\.event in \('execution-start', 'execution-complete', 'output-delivered'\)/);
    expect(pending).not.toMatch(/tool-open/);
  });
  it("skips what the outbox already holds", () => {
    expect(pending).toMatch(/not exists \(select 1 from public\.gos_usage_outbox o/);
  });
  it("is callable by the service role only", () => {
    expect(sql).toMatch(/revoke all on function public\.gos_usage_pending\(timestamptz, integer\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.gos_usage_pending\(timestamptz, integer\) to service_role/);
  });
});

describe("gos-usage-push schedule", () => {
  it("runs every 15 minutes with the scheduled functions' secret", () => {
    const s = /cron\.schedule\('gos-usage-push'[\s\S]*?\$cron\$\);/.exec(sql)?.[0] ?? "";
    expect(s).toMatch(/'\*\/15 \* \* \* \*'/);
    expect(s).toMatch(/functions\/v1\/gos-usage-push/);
    expect(s).toMatch(/'X-Socialytics-Secret',\(select decrypted_secret from vault\.decrypted_secrets where name='socialytics_n8n_secret'\)/);
  });
});
