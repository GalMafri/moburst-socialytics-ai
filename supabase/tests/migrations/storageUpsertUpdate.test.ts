// @vitest-environment node
// QA 22 Nov 2026 (S1): an upload with upsert to a path that already holds the
// file is an insert that turns into an update, and post-footage, brand-books
// and design-references had no UPDATE policy, so sending the same file again
// was refused. On PGlite, over storage.objects with the buckets' own INSERT
// and SELECT policies (read from their migrations): refused before
// 20261122131100_storage_upsert_update_policies.sql, taken after it, with
// the same rules about who may write where.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const dir = join(functionsDir, "..", "migrations");
const migration = readFileSync(join(dir, "20261122131100_storage_upsert_update_policies.sql"), "utf8");
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

/** A policy's newest `create policy`, from the migrations before this one. */
function policy(name: string): string {
  let found = "";
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql") && x < "20261122131100").sort()) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(new RegExp(`create policy "${name}"[\\s\\S]*?;`, "g"))) found = m[0];
  }
  if (!found) throw new Error(`no policy ${name}`);
  return found;
}

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, updated_at timestamptz default now(), unique (bucket_id, name));
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function public.is_moburst_staff() returns boolean language sql as $$ select coalesce(current_setting('test.staff', true), 'off') = 'on' $$;
create function public.is_client_member(c uuid) returns boolean language sql as $$ select c::text = coalesce(current_setting('test.member_of', true), '') $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  for (const name of ["Staff read brand assets", "Staff upload brand assets", "Members upload post footage", "Members read post footage"]) await db.exec(policy(name));
}, 30_000);
afterAll(async () => { await db.close(); });

/** An upload with upsert, as the given person: what Storage runs for x-upsert. */
async function upsert(bucket: string, name: string, as: { staff?: boolean; memberOf?: string }) {
  await db.exec(`reset role; set test.staff = '${as.staff ? "on" : "off"}'; set test.member_of = '${as.memberOf ?? ""}'; set role authenticated;`);
  try {
    await db.query("insert into storage.objects (bucket_id, name) values ($1, $2) on conflict (bucket_id, name) do update set updated_at = now()", [bucket, name]);
  } finally {
    await db.exec("reset role;");
  }
}

const clip = `${CLIENT}/post-9-1700000000000-2048.mp4`;

describe("sending the same file again to a bucket with upsert", () => {
  it("is refused before the migration, though the first upload is taken", async () => {
    await upsert("post-footage", clip, { memberOf: CLIENT });
    await expect(upsert("post-footage", clip, { memberOf: CLIENT })).rejects.toThrow(/row-level security/);
    await upsert("brand-books", "brand-books/c1-book.pdf", { staff: true });
    await expect(upsert("brand-books", "brand-books/c1-book.pdf", { staff: true })).rejects.toThrow(/row-level security/);
  });

  it("is taken after it, twice over, and the migration runs twice", async () => {
    await db.exec(migration);
    await db.exec(migration);
    await upsert("post-footage", clip, { memberOf: CLIENT });
    await upsert("post-footage", clip, { staff: true });
    await upsert("brand-books", "brand-books/c1-book.pdf", { staff: true });
    await upsert("design-references", "refs/c1-post.png", { staff: true });
    await upsert("design-references", "refs/c1-post.png", { staff: true });
  });

  it("still refuses whoever the bucket's upload rule refuses", async () => {
    // A member of another client cannot write over this client's clip; nobody but staff writes over a brand book.
    await expect(upsert("post-footage", clip, { memberOf: OTHER })).rejects.toThrow();
    await expect(upsert("brand-books", "brand-books/c1-book.pdf", { memberOf: CLIENT })).rejects.toThrow();
  });
});
