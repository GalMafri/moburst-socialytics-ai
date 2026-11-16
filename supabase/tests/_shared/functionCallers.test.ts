// @vitest-environment node
// Every deployed function has a caller. A function nobody calls still deploys,
// still holds a secret-checking door open and still has to be kept type-correct
// (twelve such functions were found on 11 Nov 2026). A caller is the app
// (src), another function, a cron command or database function in the
// migrations, or an n8n workflow still in service (n8n/). Functions reached only
// from outside the repository are the short list below, each with the reason.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const root = join(functionsDir, "..", "..");
const folders = readdirSync(functionsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "_shared").map((d) => d.name).sort();

const OUTSIDE_DOORS: Record<string, string> = {
  api: "the public API, called by integrators",
  mcp: "the MCP server, called by Claude clients",
  "gos-auth-bridge": "the gOS sign-in handoff, called by the browser from another site",
  "hub-auth-bridge": "the Hub sign-in handoff, called by the browser from another site",
  "google-auth": "the Google OAuth redirect",
  "higgsfield-auth": "the Higgsfield OAuth redirect",
  "update-competitive-report": "the competitive n8n workflow's report writer, kept as the fallback engine (its workflow export is not in the repository)",
  "agent-brief": "read by the Creative agent that runs outside the app",
};

function walk(dir: string, accept: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}
const isCode = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes(`${sep}test${sep}`);
// A mention in a comment is not a call.
const code = (text: string, file: string) => (file.endsWith(".sql")
  ? text.replace(/--.*$/gm, "")
  : file.endsWith(".json") ? text
  : text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1"));
const sources = [
  ...walk(join(root, "src"), isCode),
  ...walk(functionsDir, isCode),
  ...walk(join(root, "supabase", "migrations"), (f) => f.endsWith(".sql")),
  // The n8n workflows still in service call the report functions over HTTP.
  ...walk(join(root, "n8n"), (f) => /\.(json|mjs)$/.test(f) && !f.includes(`${sep}fixtures${sep}`)),
].map((file) => ({ file, rel: relative(root, file).split(sep).join("/"), text: code(readFileSync(file, "utf8"), file) }));

const named = (fn: string) => {
  const re = new RegExp(`(^|[^a-z0-9-])${fn}([^a-z0-9-]|$)`);
  return sources.filter((s) => !s.rel.startsWith(`supabase/functions/${fn}/`) && re.test(s.text)).map((s) => s.rel);
};

describe("function callers", () => {
  it.each(folders)("%s has a caller or is a listed outside door", (fn) => {
    if (OUTSIDE_DOORS[fn]) return;
    expect(named(fn), `${fn} is named by nothing in src, another function or the migrations`).not.toEqual([]);
  });
  it("lists only outside doors that exist", () => {
    expect(Object.keys(OUTSIDE_DOORS).filter((d) => !folders.includes(d))).toEqual([]);
  });
});
