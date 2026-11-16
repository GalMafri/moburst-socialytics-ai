// @vitest-environment node
// 20261113100500_higgsfield_token_vault.sql, applied to PGlite with a stand-in
// Vault: the stored Higgsfield tokens are copied into Vault with the plain
// columns left as they are (the code still running reads them); the first save
// empties the columns in the same transaction; only the server role can save
// or read them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113100500_higgsfield_token_vault.sql"), "utf8");

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create table public.integration_tokens (provider text primary key, client_id text, refresh_token text, access_token text, expires_at timestamptz);
insert into public.integration_tokens values ('higgsfield', 'cid', 'refresh-old', 'access-old', now() + interval '1 hour');
insert into public.integration_tokens values ('canva', 'cv', 'canva-refresh', 'canva-access', now());
`;

/* eslint-disable @typescript-eslint/no-explicit-any -- Rows of an ad hoc query. */
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

const asRole = async (role: string, sql: string) => {
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
  try { return await db.query<any>(sql); } finally { await db.query("select set_config('request.jwt.claim.role', '', false)"); }
};

describe("the Higgsfield tokens in Vault", () => {
  it("copies the stored tokens into Vault and leaves the plain columns as they are, so the running code still reads them", async () => {
    const read = await asRole("service_role", "select public.higgsfield_tokens_read() as t");
    expect(read.rows[0].t).toEqual({ refresh_token: "refresh-old", access_token: "access-old" });
    const { rows } = await db.query<any>("select provider, refresh_token, access_token from public.integration_tokens order by provider");
    expect(rows).toEqual([
      { provider: "canva", refresh_token: "canva-refresh", access_token: "canva-access" },
      { provider: "higgsfield", refresh_token: "refresh-old", access_token: "access-old" },
    ]);
  });

  it("can be applied again without touching what Vault holds", async () => {
    await db.exec("update vault.secrets set secret = 'kept' where name = 'socialytics_higgsfield_refresh_token'");
    await db.exec(migration);
    const read = await asRole("service_role", "select public.higgsfield_tokens_read() as t");
    expect(read.rows[0].t.refresh_token).toBe("kept");
    await db.exec("update vault.secrets set secret = 'refresh-old' where name = 'socialytics_higgsfield_refresh_token'");
  });

  it("saves a rotated pair over the same secrets and empties the Higgsfield columns in the same step", async () => {
    await asRole("service_role", "select public.higgsfield_tokens_save('refresh-new', 'access-new')");
    const read = await asRole("service_role", "select public.higgsfield_tokens_read() as t");
    expect(read.rows[0].t).toEqual({ refresh_token: "refresh-new", access_token: "access-new" });
    const { rows } = await db.query<any>("select count(*)::int as n from vault.secrets where name like 'socialytics_higgsfield_%'");
    expect(rows[0].n).toBe(2);
    const cols = await db.query<any>("select provider, refresh_token, access_token from public.integration_tokens order by provider");
    expect(cols.rows).toEqual([
      { provider: "canva", refresh_token: "canva-refresh", access_token: "canva-access" },
      { provider: "higgsfield", refresh_token: null, access_token: null },
    ]);
  });

  it("is for the server only", async () => {
    await expect(asRole("authenticated", "select public.higgsfield_tokens_read()")).rejects.toThrow();
    await expect(asRole("anon", "select public.higgsfield_tokens_save('a', 'b')")).rejects.toThrow();
  });
});
