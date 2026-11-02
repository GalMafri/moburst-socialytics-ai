// Client notes are for staff with access to the client only (client notes
// design, section 7, 2 Nov 2026): the tables and the files are the client's
// meeting notes and feedback, more sensitive than its brand books. This reads
// the migration, as copyWritersUseVoice.test.ts reads the functions, and fails
// the build when a policy on the three tables or the bucket lets anyone else in.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SQL = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261109100000_client_notes.sql"), "utf8")
  // Comments are for people; only statements are checked.
  .replace(/--[^\n]*/g, "");

const TABLES = ["client_notes", "client_note_points", "client_note_links"];

/** Every create policy statement, with the table it is on. */
const policies = [...SQL.matchAll(/create policy\s+"([^"]+)"\s+on\s+(public\.\w+|storage\.objects)([\s\S]*?);/gi)]
  .map((m) => ({ name: m[1], table: m[2].replace(/^public\./, ""), body: m[3] }));

describe("client notes access", () => {
  it("turns on row level security on every new table", () => {
    for (const t of TABLES) expect(SQL, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security`, "i"));
  });

  it("guards every policy on the three tables with can_write_client on the row's client", () => {
    const onTables = policies.filter((p) => TABLES.includes(p.table));
    expect(onTables.map((p) => p.table).sort()).toEqual([...TABLES].sort());
    for (const p of onTables) {
      expect(p.body, p.name).toMatch(/to authenticated/i);
      // The condition is can_write_client(client_id) and nothing that widens it.
      const condition = p.body.replace(/^[\s\S]*?(using|with check)\s*/i, "");
      expect(condition.replace(/\s+/g, ""), p.name).toBe("(public.can_write_client(client_id))");
    }
  });

  it("drops each policy before creating it, so the migration can run twice", () => {
    for (const p of policies) expect(SQL, p.name).toContain(`drop policy if exists "${p.name}"`);
  });

  it("keeps the bucket private, and guards every policy on it with can_write_client on the client in the path", () => {
    expect(SQL).toMatch(/insert into storage\.buckets[\s\S]*?'client-notes',\s*'client-notes',\s*false/i);
    expect(SQL).toMatch(/on conflict \(id\) do update set public = false/i);
    const onBucket = policies.filter((p) => p.table === "storage.objects");
    expect(onBucket.length).toBeGreaterThanOrEqual(3);
    for (const p of onBucket) {
      expect(p.body, p.name).toMatch(/bucket_id = 'client-notes'/);
      expect(p.body, p.name).toMatch(/public\.can_write_client\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/);
      // Nothing else lets a person in: no staff-wide or member check.
      expect(p.body, p.name).not.toMatch(/is_moburst_staff|is_client_member|can_access_client|public\s*=\s*true/);
    }
  });

  it("grants the tables to people as read-only and gives anonymous callers nothing", () => {
    for (const t of TABLES) {
      expect(SQL, t).toMatch(new RegExp(`revoke all on public\\.${t} from (public, )?anon`, "i"));
      expect(SQL, t).toMatch(new RegExp(`grant select on public\\.${t} to authenticated`, "i"));
      expect(SQL, t).not.toMatch(new RegExp(`grant (insert|update|delete)[^;]*public\\.${t}[^;]*to authenticated`, "i"));
    }
  });

  it("makes every security definer function fix its search path and say who may run it", () => {
    const fns = [...SQL.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)[\s\S]*?\$\$;/gi)];
    expect(fns.length).toBeGreaterThan(0);
    for (const [text, name] of fns) {
      if (!/security definer/i.test(text)) continue;
      expect(text, name).toMatch(/set search_path = public/i);
      expect(SQL, name).toMatch(new RegExp(`revoke all on function ${name.replace(".", "\\.")}\\(`, "i"));
      expect(SQL, name).toMatch(new RegExp(`grant execute on function ${name.replace(".", "\\.")}\\(`, "i"));
    }
  });
});
