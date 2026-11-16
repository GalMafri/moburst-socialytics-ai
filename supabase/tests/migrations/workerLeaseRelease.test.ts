// @vitest-environment node
// 20261013220000_worker_lease.sql with 20261113101020_worker_lease_release_deletes.sql,
// applied to PGlite: a released lease leaves no row behind, claiming still
// works, and a lease another holder has is not touched by a stale release.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const read = (f: string) => readFileSync(join(functionsDir, "..", "migrations", f), "utf8");
const SETUP = "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(read("20261013220000_worker_lease.sql"));
  await db.exec(read("20261113101020_worker_lease_release_deletes.sql"));
  await db.exec(read("20261113101020_worker_lease_release_deletes.sql"));
});
afterAll(async () => { await db.close(); });

const claim = async (name: string, holder: string) => (await db.query<{ v: boolean }>("select public.claim_worker_lease($1, $2::uuid, 60) as v", [name, holder])).rows[0].v;
const release = (name: string, holder: string) => db.query("select public.release_worker_lease($1, $2::uuid)", [name, holder]);
const rows = async (name: string) => (await db.query("select * from public.worker_leases where name = $1", [name])).rows;

describe("release_worker_lease", () => {
  it("deletes the row it releases, so no lease row stays for good", async () => {
    expect(await claim("settle:x", A)).toBe(true);
    expect(await rows("settle:x")).toHaveLength(1);
    await release("settle:x", A);
    expect(await rows("settle:x")).toHaveLength(0);
  });

  it("can be claimed again after a release, by anyone", async () => {
    await claim("settle:y", A);
    await release("settle:y", A);
    expect(await claim("settle:y", B)).toBe(true);
    expect(await claim("settle:y", A)).toBe(false);
  });

  it("claims a lease that is held, expired or missing as one statement: the holder renews, another waits, an expired one is taken over", async () => {
    expect(await claim("plan:a", A)).toBe(true);
    expect(await claim("plan:a", A)).toBe(true);
    expect(await claim("plan:a", B)).toBe(false);
    await db.query("update public.worker_leases set lease_until = now() - interval '1 second' where name = 'plan:a'");
    expect(await claim("plan:a", B)).toBe(true);
    expect((await rows("plan:a"))[0].holder).toBe(B);
    // A lease released earlier and a row cleared with no holder both claim at once.
    await release("plan:a", B);
    expect(await claim("plan:a", A)).toBe(true);
    await db.query("insert into public.worker_leases (name) values ('plan:b')");
    expect(await claim("plan:b", B)).toBe(true);
  });

  it("leaves a lease another holder has when a stale pass releases", async () => {
    await claim("settle:z", A);
    await release("settle:z", B);
    expect(await rows("settle:z")).toHaveLength(1);
    expect(await claim("settle:z", B)).toBe(false);
  });
});
