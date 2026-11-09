// @vitest-environment node
// 20261110120000_onboarding_complete.sql, applied twice to PGlite over the
// smallest schema it touches: the lifecycle's one write records where each
// value came from, and nothing else about the write changes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261110120000_onboarding_complete.sql"), "utf8");

const OLO = "00000000-0000-4000-8000-000000000001";
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.clients (id uuid primary key, name text, website_url text, brand_identity jsonb, logo_url text, timezone text, geo text, language text,
  location jsonb, brief_text text, content_pillars jsonb, pillars_source text, pillars_derived_at timestamptz, social_keywords text[], primary_platforms text[],
  company_slug text, hub_company_name text, field_sources jsonb not null default '{}'::jsonb);
create function public.lifecycle_tracked_fields() returns text[] language sql immutable as $$
  select array['brand_identity', 'logo_url', 'timezone', 'geo', 'language', 'brief_text', 'content_pillars',
               'social_keywords', 'primary_platforms', 'company_slug', 'hub_company_name', 'website_url']
$$;
insert into public.clients (id, name, timezone, field_sources) values ('${OLO}', 'Olo', 'America/Chicago', '{"timezone": {"by": "person", "at": "2026-10-19"}}');
`;

let db: PGlite;
const write = async (fields: object) => (await db.query<{ v: { written: string[]; skipped: string[] } }>("select public.lifecycle_write_client($1, $2::jsonb) as v", [OLO, JSON.stringify(fields)])).rows[0].v;
const client = async () => (await db.query<Record<string, unknown>>("select * from public.clients where id = $1", [OLO])).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("20261110120000_onboarding_complete.sql", () => {
  it("records where each written value came from, and never writes the sources as a column", async () => {
    const out = await write({ logo_url: "https://x/logo-profile-linkedin.png", language: "en,he", _from: { logo_url: "profile_picture:linkedin", language: "posts" } });
    expect(out.written.sort()).toEqual(["language", "logo_url"]);
    expect(out.skipped).toEqual([]);
    const c = await client();
    expect(c).toMatchObject({ logo_url: "https://x/logo-profile-linkedin.png", language: "en,he" });
    expect((c.field_sources as Record<string, Record<string, unknown>>).logo_url).toMatchObject({ by: "lifecycle", from: "profile_picture:linkedin" });
    expect((c.field_sources as Record<string, Record<string, unknown>>).language).toMatchObject({ by: "lifecycle", from: "posts" });
  });

  it("drops the source when a value is written again without one, as the website's logo is", async () => {
    await write({ logo_url: "https://olo.com/logo.svg" });
    const sources = (await client()).field_sources as Record<string, Record<string, unknown>>;
    expect(sources.logo_url.by).toBe("lifecycle");
    expect(sources.logo_url.from).toBeUndefined();
  });

  it("still skips a person's value, with or without a source", async () => {
    expect(await write({ timezone: "Asia/Jerusalem", _from: { timezone: "followers" } })).toEqual({ written: [], skipped: ["timezone"] });
    const c = await client();
    expect(c.timezone).toBe("America/Chicago");
    expect((c.field_sources as Record<string, Record<string, unknown>>).timezone).toEqual({ by: "person", at: "2026-10-19" });
  });

  it("keeps the location as the lifecycle's own record, and refuses a field it does not write", async () => {
    expect(await write({ location: { source: "followers", timezone: "America/Chicago" }, _from: { location: "followers" } })).toEqual({ written: ["location"], skipped: [] });
    expect(((await client()).field_sources as Record<string, unknown>).location).toBeUndefined();
    await expect(write({ name: "Olo Inc" })).rejects.toThrow(/does not write name/);
  });

  it("can be called by the server only", async () => {
    const grants = (await db.query<{ grantee: string }>(`select grantee from information_schema.routine_privileges where routine_name = 'lifecycle_write_client' and privilege_type = 'EXECUTE'`)).rows.map((r) => r.grantee);
    expect(grants).toContain("service_role");
    expect(grants).not.toContain("authenticated");
    expect(grants).not.toContain("anon");
  });
});
