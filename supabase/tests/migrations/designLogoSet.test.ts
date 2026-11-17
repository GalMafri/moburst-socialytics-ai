// @vitest-environment node
// 20261116120000_design_logo_set.sql, applied twice to PGlite: the logo_set
// column of a client's design settings, the function that settles it only
// while the logo and a person's second file are what was read, the function
// a signed-in person adds or removes a second file with, and the mark-person
// trigger, which leaves the row whose it is when only the set changed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migrations = join(functionsDir, "..", "migrations");
const migration = readFileSync(join(migrations, "20261116120000_design_logo_set.sql"), "utf8");
const lookTime = readFileSync(join(migrations, "20261110210000_lifecycle_look_time.sql"), "utf8");

const C1 = "00000000-0000-4000-8000-000000000001", C2 = "00000000-0000-4000-8000-000000000002";
const LOGO = `${C1}/design-settings/logo-site-aaaa.png`;
const OTHER = `${C1}/design-settings/logo-other-1.png`;

// What a Supabase project gives the migration: the three roles, auth.role() from the request's claims, the two
// checks a person's call goes through (stubs that read a setting), and the tables as the earlier migrations left them.
const SETUP = `
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create function public.can_write_client(c uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.can_write', true), '') = c::text $$;
create function public.is_oauth_session() returns boolean language sql stable as $$ select coalesce(current_setting('test.oauth', true), '') = '1' $$;
create table public.clients (id uuid primary key, archived_at timestamptz);
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text, client_id uuid, dedupe_key text, priority smallint, available_at timestamptz, status text not null default 'queued');
create table public.design_brand_settings (
  client_id uuid primary key references public.clients(id),
  logo_path text not null, placement jsonb not null, background text not null, reference_paths text[] not null,
  confirmed_at timestamptz, confirmed_by uuid, updated_at timestamptz not null default now(),
  source text not null default 'person', derived jsonb
);
alter table public.design_brand_settings enable row level security;
grant select, insert, update on public.design_brand_settings to authenticated;
grant all on public.design_brand_settings to service_role;
create policy r on public.design_brand_settings for select to authenticated using (true);
create policy i on public.design_brand_settings for insert to authenticated with check (public.can_write_client(client_id));
create policy u on public.design_brand_settings for update to authenticated using (public.can_write_client(client_id)) with check (public.can_write_client(client_id));
create function public.design_settings_mark_person() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then new.source := 'person'; end if;
  return new;
end $$;
create trigger design_brand_settings_source before insert or update on public.design_brand_settings
  for each row execute function public.design_settings_mark_person();
insert into public.clients (id) values ('${C1}'), ('${C2}');
`;

/* eslint-disable @typescript-eslint/no-explicit-any -- Rows of an ad hoc query. */
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(lookTime);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

/** One statement as a role, with the request's claims saying the same, and optionally a client the person may write. */
async function as(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = [], opts: { canWrite?: string; oauth?: boolean } = {}): Promise<any[]> {
  await db.query("select set_config('request.jwt.claim.role', $1, false), set_config('test.can_write', $2, false), set_config('test.oauth', $3, false)", [role, opts.canWrite ?? "", opts.oauth ? "1" : ""]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<any>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.role', '', false), set_config('test.can_write', '', false), set_config('test.oauth', '', false)");
  }
}
const row = async (client = C1) => (await db.query<any>("select * from public.design_brand_settings where client_id = $1", [client])).rows[0];
const jobs = async (client = C1) => (await db.query<any>("select count(*)::int as n from public.scheduled_jobs where kind = 'lifecycle' and client_id = $1 and status = 'queued'", [client])).rows[0].n;
const settle = (of: string, person: unknown, set: unknown, client = C1) =>
  as("service_role", "select public.settle_design_logo_set($1, $2, $3::jsonb, $4::jsonb) as ok", [client, of, person === null ? null : JSON.stringify(person), JSON.stringify(set)]).then((r) => r[0].ok as boolean);
const SET = { of: LOGO, rule: 1, own: "light", both: false, other: null, white: null, canvas: { file: "stored", ground: "#FFFFFF", from: "settings" } };

beforeEach(async () => {
  await db.exec("delete from public.design_brand_settings; delete from public.scheduled_jobs;");
  // One row the lifecycle wrote, one a person set.
  await db.query(
    `insert into public.design_brand_settings (client_id, logo_path, placement, background, reference_paths, confirmed_at, updated_at, source, derived) values
      ($1, $2, '{"anchor":"center","width":0.25,"top":0.04}', '#FFFFFF', '{a.jpg}', '2026-11-01T08:00:00Z', '2026-11-01T08:00:00Z', 'lifecycle', '{"at":"2026-11-01T08:00:00Z"}'),
      ($3, 'c2/logo.png', '{"anchor":"left","width":0.3,"top":0.05,"left":0.05}', '#0C1D2F', '{b.jpg}', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z', 'person', null)`,
    [C1, LOGO, C2],
  );
});

describe("settling a logo set", () => {
  it("settles the set only while the logo and the person's file are what was read", async () => {
    expect(await settle(LOGO, null, SET)).toBe(true);
    expect((await row()).logo_set).toEqual(SET);

    // The logo moved on.
    expect(await settle(`${C1}/another.png`, null, { ...SET, own: "dark" })).toBe(false);
    expect((await row()).logo_set).toEqual(SET);

    // A person put a second file there while the set was being made.
    const person = { path: OTHER, of: LOGO, at: "2026-11-16T09:00:00+00:00" };
    await db.query("update public.design_brand_settings set logo_set = logo_set || $2::jsonb where client_id = $1", [C1, JSON.stringify({ person })]);
    expect(await settle(LOGO, null, { ...SET, own: "dark" })).toBe(false);
    expect((await row()).logo_set.own).toBe("light");
    // Read with that file: it settles.
    expect(await settle(LOGO, person, { ...SET, own: "dark" })).toBe(true);
    expect((await row()).logo_set.own).toBe("dark");
    // A client with no settings row.
    expect(await settle(LOGO, null, SET, "00000000-0000-4000-8000-000000000009")).toBe(false);
  });

  it("keeps the row's own person key, whatever the set handed in says", async () => {
    const person = { path: OTHER, of: LOGO, at: "2026-11-16T09:00:00+00:00" };
    await db.query("update public.design_brand_settings set logo_set = $2::jsonb where client_id = $1", [C1, JSON.stringify({ person })]);
    expect(await settle(LOGO, person, { ...SET, person: { path: "x", of: "y", at: "z" } })).toBe(true);
    expect((await row()).logo_set).toEqual({ ...SET, person });
    // With no person key on the row, none is written.
    await db.query("update public.design_brand_settings set logo_set = null where client_id = $1", [C1]);
    expect(await settle(LOGO, null, { ...SET, person: { path: "x", of: "y", at: "z" } })).toBe(true);
    expect((await row()).logo_set).toEqual(SET);
  });

  it("writes nothing but the set", async () => {
    for (const [client, of] of [[C1, LOGO], [C2, "c2/logo.png"]] as const) {
      const { logo_set: _before, ...before } = await row(client);
      expect(await settle(of, null, { ...SET, of }, client)).toBe(true);
      const { logo_set, ...after } = await row(client);
      expect(after).toEqual(before);
      expect(logo_set.of).toBe(of);
    }
    expect((await row(C2)).source).toBe("person");
  });

  it("lets only the service role settle a set", async () => {
    const call = "select public.settle_design_logo_set($1, $2, null, '{}'::jsonb)";
    await expect(as("authenticated", call, [C1, LOGO], { canWrite: C1 })).rejects.toMatchObject({ code: "42501" });
    await expect(as("anon", call, [C1, LOGO])).rejects.toMatchObject({ code: "42501" });
  });
});

describe("a person's second logo file", () => {
  const put = (path: string | null, opts: { canWrite?: string; oauth?: boolean } = { canWrite: C1 }, client = C1) =>
    as("authenticated", "select public.set_design_logo_other($1, $2)", [client, path], opts);

  it("keeps the row the lifecycle's when a person replaces the second file", async () => {
    await settle(LOGO, null, SET);
    await put(OTHER);
    const after = await row();
    expect(after.source).toBe("lifecycle");
    expect(after.logo_set.person).toMatchObject({ path: OTHER, of: LOGO });
    expect(Number.isNaN(Date.parse(after.logo_set.person.at))).toBe(false);
    // The rest of the set is as it was until the lifecycle settles it again.
    const { person: _p, ...rest } = after.logo_set;
    expect(rest).toEqual(SET);
    expect(new Date(after.updated_at).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(new Date(after.confirmed_at).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(await jobs()).toBe(1);
  });

  it("starts a set that holds only the person's file when none exists yet", async () => {
    await put(OTHER);
    expect(Object.keys((await row()).logo_set)).toEqual(["person"]);
    expect((await row()).source).toBe("lifecycle");
  });

  it("removes a person's second file and queues a look", async () => {
    await settle(LOGO, null, SET);
    await put(OTHER);
    await db.exec("delete from public.scheduled_jobs");
    await put(null);
    const after = await row();
    expect(after.logo_set).toEqual(SET);
    expect(after.source).toBe("lifecycle");
    expect(await jobs()).toBe(1);
  });

  it("marks the row a person's when they save the card", async () => {
    await settle(LOGO, null, SET);
    await as("authenticated", "update public.design_brand_settings set background = '#101010' where client_id = $1", [C1], { canWrite: C1 });
    const after = await row();
    expect(after.source).toBe("person");
    expect(after.background).toBe("#101010");
    expect(after.logo_set).toEqual(SET);
  });

  it("refuses a second file from someone who cannot write the client", async () => {
    await expect(put(OTHER, { canWrite: C2 })).rejects.toMatchObject({ code: "42501" });
    await expect(put(OTHER, {})).rejects.toMatchObject({ code: "42501" });
    await expect(as("anon", "select public.set_design_logo_other($1, $2)", [C1, OTHER])).rejects.toMatchObject({ code: "42501" });
    expect((await row()).logo_set).toBeNull();
    expect(await jobs()).toBe(0);
  });

  it("refuses a second file outside the client's own design settings folder", async () => {
    for (const path of [`${C2}/design-settings/logo-other-1.png`, `${C1}/design-settings/logo-site-1.png`, `${C1}/design-settings/logo-other-1.jpg`, `${C1}/canva-finish/logo-other-1.png`, ""]) {
      await expect(put(path), path).rejects.toMatchObject({ code: "22023" });
    }
    expect((await row()).logo_set).toBeNull();
  });

  it("refuses a Claude connector session", async () => {
    await expect(put(OTHER, { canWrite: C1, oauth: true })).rejects.toMatchObject({ code: "42501" });
  });

  it("puts back the set when a signed-in person writes it straight into the row", async () => {
    await settle(LOGO, null, SET);
    await as("authenticated", `update public.design_brand_settings set logo_set = '{"of":"x"}'::jsonb where client_id = $1`, [C1], { canWrite: C1 });
    expect((await row()).logo_set).toEqual(SET);
    // Such a write is a person's write of the row, as any other.
    expect((await row()).source).toBe("person");
    await db.exec("delete from public.design_brand_settings");
    await as("authenticated", `insert into public.design_brand_settings (client_id, logo_path, placement, background, reference_paths, logo_set) values ($1, $2, '{"anchor":"center","width":0.25,"top":0.04}', '#FFFFFF', '{a.jpg}', '{"of":"x"}'::jsonb)`, [C1, LOGO], { canWrite: C1 });
    expect((await row()).logo_set).toBeNull();
    expect((await row()).source).toBe("person");
  });

  it("leaves the lifecycle's own write of the settings, and its set, alone", async () => {
    await settle(LOGO, null, SET);
    await as("service_role", "update public.design_brand_settings set background = '#121212' where client_id = $1", [C1]);
    expect((await row()).source).toBe("lifecycle");
    expect((await row()).logo_set).toEqual(SET);
  });
});
