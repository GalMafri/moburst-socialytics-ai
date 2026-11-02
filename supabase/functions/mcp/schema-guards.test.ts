// @vitest-environment node
// The migrations, read as text in the order they apply, keep a session from
// Supabase's OAuth server (the Claude connector) read-only:
//   * every table with row level security has the three restrictive "OAuth
//     sessions cannot ..." policies: 20261109120000_claude_connector.sql adds
//     them to every such table that exists when it runs, and a table a later
//     migration creates needs them added there;
//   * every SECURITY DEFINER function that is not read-only (not stable or
//     immutable, not a trigger) and that the authenticated role can execute
//     refuses an OAuth session first: a definer function runs as its owner,
//     who bypasses row level security, so the table policies do not reach it.
// A new table or write function without its guard fails here.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const CONNECTOR = "20261109120000_claude_connector.sql";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "");
const bare = (name: string) => name.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();

interface Fn { name: string; file: string; definer: boolean; readOnly: boolean; trigger: boolean; body: string; executable: boolean }

/** Each public function as the migrations leave it: its last definition and whether `authenticated` can still execute it. */
function functions(): Map<string, Fn> {
  const out = new Map<string, Fn>();
  for (const file of files) {
    const sql = sqlOf(file);
    const statements: Array<{ at: number; apply: () => void }> = [];
    const def = /create\s+(?:or\s+replace\s+)?function\s+((?:"?public"?\.)?"?[\w]+"?)\s*\(/gi;
    for (let m = def.exec(sql); m; m = def.exec(sql)) {
      const open = /(\$[\w]*\$)/.exec(sql.slice(m.index));
      if (!open) continue;
      const bodyStart = m.index + open.index + open[1].length;
      const bodyEnd = sql.indexOf(open[1], bodyStart);
      const end = sql.indexOf(";", bodyEnd);
      const attrs = (sql.slice(m.index, bodyStart - open[1].length) + " " + sql.slice(bodyEnd + open[1].length, end)).toLowerCase();
      const name = bare(m[1]);
      statements.push({ at: m.index, apply: () => {
        const was = out.get(name);
        out.set(name, {
          name, file, definer: /security\s+definer/.test(attrs), readOnly: /\b(stable|immutable)\b/.test(attrs), trigger: /returns\s+(event_)?trigger\b/.test(attrs),
          body: sql.slice(bodyStart, bodyEnd).toLowerCase(),
          // Supabase grants execute on a new public function to authenticated; a replaced one keeps its grants.
          executable: was ? was.executable : true,
        });
      } });
    }
    const acl = /(grant|revoke)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+function\s+([\s\S]*?)\s+(?:to|from)\s+([\w\s,]+?)\s*;/gi;
    for (let m = acl.exec(sql); m; m = acl.exec(sql)) {
      const op = m[1].toLowerCase(), roles = m[3].toLowerCase().split(/\s*,\s*/), names = [...m[2].matchAll(/(?:"?public"?\.)?"?(\w+)"?\s*\(/gi)].map((x) => x[1].toLowerCase());
      if (!roles.includes("authenticated")) continue;
      statements.push({ at: m.index, apply: () => { for (const n of names) { const f = out.get(n); if (f) f.executable = op === "grant"; } } });
    }
    const drop = /drop\s+function\s+(?:if\s+exists\s+)?((?:"?public"?\.)?"?\w+"?)/gi;
    for (let m = drop.exec(sql); m; m = drop.exec(sql)) statements.push({ at: m.index, apply: () => out.delete(bare(m![1])) });
    for (const s of statements.sort((a, b) => a.at - b.at)) s.apply();
  }
  return out;
}

const writeFunctions = () => [...functions().values()].filter((f) => f.definer && !f.readOnly && !f.trigger && f.executable);
const guarded = (f: Fn) => /if\s+public\.is_oauth_session\(\)\s+then\s+raise\s+exception/.test(f.body);

describe("the OAuth write guards", () => {
  it("exist: the connector migration guards every table with row level security, storage objects included", () => {
    const sql = sqlOf(CONNECTOR).toLowerCase();
    expect(sql).toContain("create or replace function public.is_oauth_session()");
    expect(sql).toMatch(/from pg_class[\s\S]*relrowsecurity and n.nspname = 'public'/);
    expect(sql).toContain("to_regclass('storage.objects')");
    for (const op of ["insert", "update", "delete"]) expect(sql).toContain(`oauth sessions cannot ${op}`);
  });

  it("cover every table a later migration creates", () => {
    // Either policies named for the table, or the connector's loop run again after the table exists.
    const loopAt = (sql: string) => (/relrowsecurity/.test(sql) && sql.includes("OAuth sessions cannot insert") ? sql.lastIndexOf("relrowsecurity") : -1);
    const missing: string[] = [];
    for (const file of files.filter((f) => f > CONNECTOR)) {
      const sql = sqlOf(file);
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?public"?\.)?"?\w+"?)/gi)) {
        const table = bare(m[1]);
        const named = new RegExp(`create\\s+policy\\s+"OAuth sessions cannot insert"\\s+on\\s+(?:public\\.)?"?${table}"?\\b`, "i");
        const covered = files.filter((f) => f >= file).some((f) => named.test(sqlOf(f)) || (f === file ? loopAt(sql) > (m.index ?? 0) : loopAt(sqlOf(f)) >= 0));
        if (!covered) missing.push(`${file}: ${table}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("are the first thing every write function the authenticated role can call does", () => {
    const writes = writeFunctions();
    expect(writes.map((f) => f.name).sort()).toEqual(expect.arrayContaining(["lifecycle_request", "trend_search_override_clear", "trend_term_add", "trend_term_remove", "trend_theme_dismiss"]));
    expect(writes.filter((f) => !guarded(f)).map((f) => `${f.file}: ${f.name}`)).toEqual([]);
    for (const f of writes) {
      const firstWrite = f.body.search(/\b(insert\s+into|update\s+[\w."]+\s+set|delete\s+from)\b/);
      expect(f.body.indexOf("is_oauth_session()"), f.name).toBeLessThan(firstWrite < 0 ? Infinity : firstWrite);
    }
  });

  it("leave read functions and server-only functions alone", () => {
    const all = functions();
    expect(guarded(all.get("trend_themes_in_range")!)).toBe(false);
    expect(all.get("api_key_touch")!.executable).toBe(false);
    expect(all.get("mcp_rate_touch")!.executable).toBe(false);
    expect(all.get("mcp_rate_touch")!.definer).toBe(true);
  });
});
