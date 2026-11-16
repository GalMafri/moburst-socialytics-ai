// @vitest-environment node
// get_user_detail hands the app typed values (timestamps and a numeric median) and the app formats them,
// so the People table and the detail panel show the same day. The other five functions are unchanged.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const sql = readFileSync(join(functionsDir, "..", "migrations", "20261113100200_usage_admin_functions.sql"), "utf8");
const block = (name: string) => sql.match(new RegExp(`create or replace function public\\.${name}\\(.*?\\$function\\$;\\n`, "s"))?.[0] ?? "";

describe("usage admin functions migration", () => {
  const detail = block("get_user_detail");

  it("returns timestamps and a numeric median, not text the database formatted", () => {
    expect(detail).toMatch(/returns table\([^)]*\bat timestamp with time zone/);
    expect(detail).toMatch(/returns table\([^)]*\bamount numeric/);
    expect(detail).not.toMatch(/to_char\(/);
    expect(detail).toMatch(/percentile_cont\(0\.5\) within group \(order by duration_minutes\) from runs\)::numeric\)/);
  });

  it("drops the old three-column version first, since a function cannot change its return type in place", () => {
    expect(sql).toMatch(/drop function if exists public\.get_user_detail\(text\);/);
    expect(sql.indexOf("drop function if exists public.get_user_detail(text)")).toBeLessThan(sql.indexOf("create or replace function public.get_user_detail"));
  });

  it("keeps the other five functions byte for byte", () => {
    const sha = (name: string) => createHash("sha256").update(block(name)).digest("hex");
    expect(sha("get_funnel")).toBe("f8ab0b458e1d162ea2c4c8fe0e6f963790e9f15570aaca07180ab8114e94e309");
    expect(sha("get_ai_quality")).toBe("6a8b5f43b697b64ba22801cdb13c4ab23147ffce27e5220e02246da8afcad1fb");
    expect(sha("get_report_engagement")).toBe("e2e2229a3175c7b13356fb021cbe6bd0883155b17440ffe6cbe60efb37233aa5");
    expect(sha("get_session_quality")).toBe("d6fb04ea3db98f1c585f1f3405c6f648c68b19e332af540a7e4d71f872db40b9");
    expect(sha("get_user_timeline")).toBe("cfdde38c20d65ba7e1b5a54597828a86c5c1f08b3917506b78654c713b75672b");
  });
});
