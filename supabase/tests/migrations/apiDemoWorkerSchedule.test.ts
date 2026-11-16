// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const dir = join(functionsDir, "..", "migrations");

/** The newest `cron.schedule('api-demo-worker', ...)` body across the migrations. */
function newestSchedule(): string {
  let found = "";
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const m of sql.matchAll(/cron\.schedule\('api-demo-worker'[\s\S]*?\$cron\$\);/g)) found = m[0];
  }
  return found;
}

describe("api-demo-worker schedule", () => {
  it("posts only when a demo job is ready to be leased, by the same test demo_jobs_lease uses", () => {
    const s = newestSchedule();
    expect(s).toMatch(/where exists \(select 1 from public\.demo_jobs where status in \('queued',\s*'running'\)/);
    expect(s).toMatch(/lease_until is null or lease_until < now\(\)/);
    expect(s).toMatch(/next_check_at is null or next_check_at <= now\(\)/);
  });
});
