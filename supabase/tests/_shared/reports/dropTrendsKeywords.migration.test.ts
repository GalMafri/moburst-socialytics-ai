// @vitest-environment node
// Trends plan Task 18: clients.trends_keywords is dropped
// (20261111100000_drop_trends_keywords.sql, applied twice to PGlite), and
// nothing the app runs reads or writes the column: the social request sends
// the field empty for n8n's kept workflow, the in-app report reads it from
// that request only, and the API's schema check does not expect it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { TABLE_COLUMNS } from "../../../functions/api/schema-check";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const migration = readFileSync(join(root, "supabase", "migrations", "20261111100000_drop_trends_keywords.sql"), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "node_modules" ? [] : files(p)) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("20261111100000_drop_trends_keywords.sql", () => {
  it("drops the column and keeps every other, applied twice", async () => {
    const db = new PGlite();
    await db.exec("create table public.clients (id uuid primary key, name text, social_keywords text[], trends_keywords text default '');");
    await db.exec("insert into public.clients values ('00000000-0000-4000-8000-000000000001', 'Moburst', '{ai}', 'x,y');");
    await db.exec(migration);
    await db.exec(migration);
    const columns = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'clients' order by ordinal_position")).rows.map((r) => r.column_name);
    expect(columns).toEqual(["id", "name", "social_keywords"]);
    expect((await db.query("select * from public.clients")).rows).toEqual([{ id: "00000000-0000-4000-8000-000000000001", name: "Moburst", social_keywords: ["ai"] }]);
    await db.close();
  });
});

describe("nothing the app runs uses clients.trends_keywords", () => {
  it("the API's schema check does not expect it", () => {
    for (const [, columns] of TABLE_COLUMNS) expect(columns.split(/\s*,\s*/)).not.toContain("trends_keywords");
  });

  it("only the social request names the field: sent empty for n8n, read from the request by the in-app port of n8n's node", () => {
    const named = [...files(join(root, "src")), ...files(join(root, "supabase", "functions"))]
      .filter((f) => !f.endsWith(join("integrations", "supabase", "types.ts")))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ at: `${relative(root, f)}:${i + 1}`, line })))
      .filter(({ line }) => line.includes("trends_keywords"));
    expect(named.map(({ at, line }) => `${at.replace(/:\d+$/, "")} ${line.trim()}`)).toEqual([
      "supabase/functions/_shared/pipelines/social/nodes.ts const trendsKeywordsRaw = clientData.trends_keywords || \"\";",
      "supabase/functions/_shared/pipelines/social/nodes.ts trends_keywords: trendsKeywords,",
      "supabase/functions/_shared/reports/payloads.ts trends_keywords: \"\",",
    ]);
  });
});
