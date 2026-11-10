// @vitest-environment node
// 20261111130000_video_approved_price.sql, applied twice to PGlite over the
// design_requests table. The Higgsfield price for a video's one clip is read
// at the press (or at a single post's request) and kept on the request; the
// clip step orders only at that price or less. A still has no price.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261111130000_video_approved_price.sql"), "utf8");

// design_requests as far as this migration needs it.
const SETUP = `
create table public.design_requests (id uuid primary key, client_id uuid not null, kind text not null default 'single', status text not null default 'preparing');
`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });

describe("design_requests.approved_credits", () => {
  it("is a nullable number with a comment saying what it holds", async () => {
    const { rows } = await db.query<{ data_type: string; is_nullable: string; comment: string | null }>(`
      select c.data_type, c.is_nullable, col_description('public.design_requests'::regclass, c.ordinal_position) as comment
      from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'design_requests' and c.column_name = 'approved_credits'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ data_type: "numeric", is_nullable: "YES" });
    expect(rows[0].comment).toMatch(/Higgsfield price/);
  });

  it("keeps a video's approved price, and a still keeps none", async () => {
    await db.exec(`insert into public.design_requests (id, client_id, kind, approved_credits) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'video', 128.5)`);
    await db.exec(`insert into public.design_requests (id, client_id, kind) values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c1', 'single')`);
    const { rows } = await db.query<{ kind: string; approved_credits: string | null }>(`select kind, approved_credits from public.design_requests order by id`);
    expect(rows.map((r) => [r.kind, r.approved_credits === null ? null : Number(r.approved_credits)])).toEqual([["video", 128.5], ["single", null]]);
  });
});
