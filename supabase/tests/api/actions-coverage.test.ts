import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { emptyData, makeFakeStore } from "../_shared/socialytics-api/store.fake";
import { socialyticsActions } from "../../functions/_shared/socialytics-api/actions";
import { INTERNAL_ONLY } from "../../functions/api/internal-only";
import { functionsDir } from "../paths";
import { stubRoutes } from "./stub";

/**
 * Classify or fail. Everything a person can do in Socialytics goes through an
 * edge function the screens call. Each one must be either mapped by a public
 * action (supabase/functions/_shared/socialytics-api/actions.ts, `maps`) or listed in
 * INTERNAL_ONLY (supabase/functions/api/internal-only.ts) with the reason, so a new feature fails here until
 * someone decides whether the API, AgentBurst and Claude may start it.
 */
const ROOT = join(functionsDir, "..", "..");
const SRC = join(ROOT, "src");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const isFunction = (name: string) => name !== "_shared" && existsSync(join(functionsDir, name, "index.ts"));

/**
 * Every function name the screens call, with where: a literal name given to
 * functions.invoke (on one line or split across several), a fetch to
 * /functions/v1/<name>, and, in a file that hands functions.invoke a name in
 * a variable, every quoted string in it that names a function.
 */
function screenFunctions(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (name: string, where: string) => found.set(name, [...(found.get(name) ?? []), where]);
  for (const f of files(SRC)) {
    const text = readFileSync(f, "utf8");
    const at = (i: number) => `${relative(ROOT, f)}:${text.slice(0, i).split("\n").length}`;
    for (const m of text.matchAll(/functions\s*\.\s*invoke\s*(?:<[^>]*>)?\s*\(\s*["'`]([a-z0-9][a-z0-9-]*)["'`]/g)) add(m[1], at(m.index!));
    for (const m of text.matchAll(/\/functions\/v1\/([a-z0-9][a-z0-9-]*)/g)) add(m[1], at(m.index!));
    if (/functions\s*\.\s*invoke\s*(?:<[^>]*>)?\s*\(\s*[A-Za-z_$]/.test(text)) {
      for (const m of text.matchAll(/["'`]([a-z0-9][a-z0-9-]*)["'`]/g)) if (isFunction(m[1])) add(m[1], at(m.index!));
    }
  }
  return found;
}

const unconfigured = async (): Promise<never> => { throw new Error("not called"); };
const defs = socialyticsActions({ store: makeFakeStore(emptyData()), call: unconfigured, actingUser: unconfigured, calendarPost: unconfigured });
const mapped = new Map<string, string[]>();
for (const d of defs) for (const fn of d.maps) mapped.set(fn, [...(mapped.get(fn) ?? []), d.name]);

describe("every function the screens call is classified", () => {
  const called = screenFunctions();

  it("finds the screens' calls (the scan itself works)", () => {
    // Literal names, a name in a variable (calendarRequests.ts, BrandBookUpload.tsx), and a split call.
    for (const name of ["run-report", "generate-ad-hoc-post", "identify-competitors", "api", "gos-auth-bridge", "calendar-posts", "extract-brand-from-file", "research-brand-identity"]) expect(called.has(name), name).toBe(true);
  });

  it("is mapped by a public action or marked internal with a reason", () => {
    const unclassified = [...called.entries()].filter(([name]) => !mapped.has(name) && !INTERNAL_ONLY[name]).map(([name, where]) => `${name} (called at ${where.join(", ")})`);
    expect(unclassified, "Add a public action for it in supabase/functions/_shared/socialytics-api/actions.ts (an ActionDef whose maps names it), or list it in INTERNAL_ONLY in supabase/functions/api/internal-only.ts with the reason. See CLAUDE.md, The public API.").toEqual([]);
  });

  it("is never both public and internal", () => {
    expect([...mapped.keys()].filter((n) => INTERNAL_ONLY[n])).toEqual([]);
  });

  it("gives every internal entry a reason and a function that exists", () => {
    for (const [name, reason] of Object.entries(INTERNAL_ONLY)) {
      expect(reason.trim().length, `INTERNAL_ONLY["${name}"] needs a reason`).toBeGreaterThan(20);
      expect(isFunction(name), `INTERNAL_ONLY names ${name}, which is not a function in supabase/functions; remove it`).toBe(true);
    }
  });
});

describe("every public action", () => {
  it("maps only functions that exist in supabase/functions", () => {
    for (const d of defs) {
      expect(d.maps.length, `${d.name} maps no function`).toBeGreaterThan(0);
      for (const fn of d.maps) expect(isFunction(fn), `${d.name} maps ${fn}, which is not a function in supabase/functions`).toBe(true);
    }
  });

  it("has a unique name and a route in the API that needs the run scope", () => {
    const routes = stubRoutes();
    expect(new Set(defs.map((d) => d.name)).size).toBe(defs.length);
    for (const d of defs) {
      const r = routes.find((x) => x.method === d.method && x.path === d.path);
      expect(r, `${d.name}: ${d.method} ${d.path}`).toBeDefined();
      expect(r!.scope).toBe("run");
    }
  });
});
