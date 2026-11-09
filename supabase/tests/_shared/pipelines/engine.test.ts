// @vitest-environment node
// The engine switch and the pipeline registry: n8n only where a row asks for
// it by hand; shadow per client (Moburst); app for everything else, run by an
// app-capable pipeline whose secrets are set, or waiting for one. Nothing in
// doubt goes to n8n.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { readEngine, requestedEngine, resolveEngine, type EngineRow } from "../../../functions/_shared/pipelines/engine";
import { makeRegistry, REGISTRY } from "../../../functions/_shared/pipelines/registry";
import { missingSecrets, PIPELINE_SECRETS } from "../../../functions/_shared/pipelines/secrets";
import { codeDir } from "../../paths.ts";

const MOBURST = "d00ce604-2bcc-455a-9826-f80250db75cf";
const OTHER = "11111111-1111-1111-1111-111111111111";
const DEFAULTS: EngineRow[] = [
  { kind: "social", client_id: null, engine: "n8n" },
  { kind: "competitive", client_id: null, engine: "n8n" },
  { kind: "linkedin_source", client_id: null, engine: "n8n" },
];
const noEnv = () => undefined;

/** Every secret the in-app social pipeline reads, set. */
const socialEnv = (n: string) => ({ ANTHROPIC_API_KEY: "k", SPROUT_CLIENT_ID: "i", SPROUT_CLIENT_SECRET: "s", GAMMA_API_KEY: "g", APIFY_API_TOKEN: "a" } as Record<string, string>)[n];

describe("requestedEngine", () => {
  it("is n8n for every kind and client as shipped", () => {
    for (const kind of ["social", "competitive", "linkedin_source"] as const) {
      expect(requestedEngine(DEFAULTS, kind, MOBURST)).toBe("n8n");
      expect(requestedEngine(DEFAULTS, kind, OTHER)).toBe("n8n");
    }
  });

  it("lets a client's row win over the kind's, for that client only", () => {
    const rows = [...DEFAULTS, { kind: "social", client_id: MOBURST, engine: "shadow" }];
    expect(requestedEngine(rows, "social", MOBURST)).toBe("shadow");
    expect(requestedEngine(rows, "social", OTHER)).toBe("n8n");
    expect(requestedEngine(rows, "competitive", MOBURST)).toBe("n8n");
  });

  it("is app with no rows, no table, no row for the kind, or a value it does not know", () => {
    expect(requestedEngine([], "social", MOBURST)).toBe("app");
    expect(requestedEngine(null, "social", MOBURST)).toBe("app");
    expect(requestedEngine([{ kind: "competitive", client_id: null, engine: "n8n" }], "social", MOBURST)).toBe("app");
    expect(requestedEngine([{ kind: "social", client_id: null, engine: "lambda" }], "social", null)).toBe("app");
    expect(requestedEngine([{ kind: "social", client_id: MOBURST, engine: "" }], "social", MOBURST)).toBe("app");
  });

  it("keeps an n8n row set by hand on n8n, for the kind or for one client", () => {
    expect(requestedEngine([{ kind: "social", client_id: null, engine: "n8n" }], "social", OTHER)).toBe("n8n");
    expect(requestedEngine([{ kind: "social", client_id: null, engine: "app" }, { kind: "social", client_id: MOBURST, engine: "n8n" }], "social", MOBURST)).toBe("n8n");
  });
});

describe("resolveEngine", () => {
  it("runs a shadow with the placeholder, which needs no secret", () => {
    const r = resolveEngine("shadow", "competitive", REGISTRY, noEnv);
    expect(r.engine).toBe("shadow");
    expect(r.pipeline?.name).toBe("placeholder_competitive");
  });

  it("stays on app, with no pipeline and the reason, while no app-capable pipeline of the kind has all its secrets set: never n8n", () => {
    for (const kind of ["social", "competitive", "linkedin_source"] as const) {
      const r = resolveEngine("app", kind, REGISTRY, noEnv);
      expect(r.engine).toBe("app");
      expect(r.pipeline).toBeUndefined();
      expect(r.refused).toContain("app-capable");
      expect(r.refused).not.toContain("n8n");
    }
  });

  it("takes app, and shadows with the in-app social pipeline, once its secrets are set (it has its writer)", () => {
    expect(resolveEngine("app", "social", REGISTRY, socialEnv)).toMatchObject({ engine: "app", pipeline: { name: "social_v1" } });
    expect(resolveEngine("shadow", "social", REGISTRY, socialEnv)).toMatchObject({ engine: "shadow", pipeline: { name: "social_v1" } });
    // The scrapers' token is awaited: a shadow waits for it, a real report never does.
    const noApify = (n: string) => (n === "APIFY_API_TOKEN" ? undefined : socialEnv(n));
    expect(resolveEngine("shadow", "social", REGISTRY, noApify).pipeline?.name).toBe("social_v1");
    expect(resolveEngine("app", "social", REGISTRY, noApify)).toEqual({ engine: "app", refused: expect.stringContaining("app-capable") });
  });

  it("has no app pipeline while this deployment has no writer for the kind's real report", () => {
    const registry = makeRegistry(REGISTRY.all());
    expect(resolveEngine("app", "social", registry, socialEnv)).toEqual({ engine: "app", refused: expect.stringContaining("app-capable") });
    expect(resolveEngine("shadow", "social", registry, socialEnv).pipeline?.name).toBe("social_v1");
  });

  it("keeps app waiting with no pipeline, and a shadow on the placeholder, while the real pipeline's secrets are missing", () => {
    const env = (n: string) => (n === "ANTHROPIC_API_KEY" ? "k" : undefined);
    expect(resolveEngine("app", "social", REGISTRY, env)).toEqual({ engine: "app", refused: expect.stringContaining("app-capable") });
    expect(resolveEngine("shadow", "social", REGISTRY, env).pipeline?.name).toBe("placeholder_social");
  });

  it("shadows the LinkedIn source with the in-app pipeline while APIFY_API_TOKEN is missing (it waits), and takes app only once the token is set", () => {
    expect(resolveEngine("shadow", "linkedin_source", REGISTRY, noEnv)).toMatchObject({ engine: "shadow", pipeline: { name: "linkedin_source_v1" } });
    expect(resolveEngine("app", "linkedin_source", REGISTRY, noEnv)).toEqual({ engine: "app", refused: expect.stringContaining("app-capable") });
    const withToken = (n: string) => (n === "APIFY_API_TOKEN" ? "apify-token" : undefined);
    expect(resolveEngine("app", "linkedin_source", REGISTRY, withToken)).toMatchObject({ engine: "app", pipeline: { name: "linkedin_source_v1" } });
  });

  it("shadows the competitive analysis in-app once RivalIQ and Claude are set, and takes app only with the Apify token too", () => {
    const keys = (names: string[]) => (n: string) => (names.includes(n) ? "set" : undefined);
    expect(resolveEngine("shadow", "competitive", REGISTRY, keys(["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY"]))).toMatchObject({ engine: "shadow", pipeline: { name: "competitive_v1" } });
    expect(resolveEngine("app", "competitive", REGISTRY, keys(["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY"]))).toEqual({ engine: "app", refused: expect.stringContaining("app-capable") });
    expect(resolveEngine("app", "competitive", REGISTRY, keys(["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN"]))).toMatchObject({ engine: "app", pipeline: { name: "competitive_v1" } });
    // Social needs Sprout and Gamma too: without them only its placeholder shadows, and app waits with no pipeline.
    expect(resolveEngine("app", "social", REGISTRY, keys(["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN"]))).toEqual({ engine: "app", refused: expect.stringContaining("app-capable") });
  });

  it("runs n8n for n8n", () => {
    expect(resolveEngine("n8n", "social", REGISTRY, noEnv)).toEqual({ engine: "n8n" });
  });

  it("keeps a shadow set by hand on n8n alone, with the reason, when no pipeline can run next to it", () => {
    expect(resolveEngine("shadow", "social", makeRegistry([]), noEnv)).toEqual({ engine: "shadow", refused: expect.stringContaining("next to n8n") });
  });
});

describe("readEngine", () => {
  const deps = { registry: REGISTRY, env: noEnv };
  it("reads the rows and resolves them", async () => {
    const db = fakeDb({ report_engines: [...DEFAULTS, { kind: "social", client_id: MOBURST, engine: "shadow" }] });
    expect((await readEngine(db, "social", MOBURST, deps)).engine).toBe("shadow");
    expect((await readEngine(db, "social", OTHER, deps)).engine).toBe("n8n");
  });

  it("is app with no pipeline and the reason when the table cannot be read or the read throws, never n8n", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) };
    expect(await readEngine(failing, "social", MOBURST, { registry: REGISTRY, env: socialEnv })).toEqual({ engine: "app", refused: expect.stringContaining("relation does not exist"), unreadable: true });
    const throwing = { from: () => { throw new Error("network"); } };
    expect(await readEngine(throwing, "competitive", MOBURST, deps)).toEqual({ engine: "app", refused: expect.stringContaining("network"), unreadable: true });
    // Logged for the logs, each time.
    expect(warn.mock.calls.map((c) => c.join(" "))).toEqual([expect.stringContaining("relation does not exist"), expect.stringContaining("network")]);
    warn.mockRestore();
  });

  it("runs the app pipeline for a kind with no row, once its secrets are set", async () => {
    const db = fakeDb({ report_engines: [{ kind: "competitive", client_id: null, engine: "n8n" }] });
    expect(await readEngine(db, "social", MOBURST, { registry: REGISTRY, env: socialEnv })).toMatchObject({ engine: "app", pipeline: { name: "social_v1" } });
    expect(await readEngine(db, "competitive", MOBURST, { registry: REGISTRY, env: socialEnv })).toEqual({ engine: "n8n" });
  });
});

describe("registry", () => {
  it("registers the in-app LinkedIn source, competitive and social pipelines, and one shadow-only placeholder per kind, needing no secret", () => {
    expect(REGISTRY.all().map((d) => d.name).sort()).toEqual(["competitive_v1", "linkedin_source_v1", "placeholder_competitive", "placeholder_linkedin_source", "placeholder_social", "social_v1", "trends_v1"]);
    for (const d of REGISTRY.all().filter((x) => x.name.startsWith("placeholder_"))) {
      expect(d.modes).toEqual(["shadow"]);
      expect(d.appCapable).toBe(false);
      expect(d.secrets).toEqual([]);
    }
    expect(REGISTRY.get("linkedin_source_v1")).toMatchObject({ kind: "linkedin_source", modes: ["shadow", "app"], appCapable: true, secrets: [], awaitedSecrets: ["APIFY_API_TOKEN"] });
    expect(REGISTRY.get("competitive_v1")).toMatchObject({ kind: "competitive", modes: ["shadow", "app"], appCapable: true, secrets: ["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY"], awaitedSecrets: ["APIFY_API_TOKEN"] });
    expect(REGISTRY.get("social_v1")).toMatchObject({ kind: "social", modes: ["shadow", "app"], appCapable: true, secrets: ["ANTHROPIC_API_KEY", "SPROUT_CLIENT_ID", "SPROUT_CLIENT_SECRET", "GAMMA_API_KEY"], awaitedSecrets: ["APIFY_API_TOKEN"] });
  });

  it("refuses two pipelines with one name, a missing first step, and an app-capable pipeline without app mode", () => {
    const one = REGISTRY.get("placeholder_social")!;
    expect(() => makeRegistry([one, one])).toThrow("Two pipelines");
    expect(() => makeRegistry([{ ...one, first: "nope" }])).toThrow("does not define");
    expect(() => makeRegistry([{ ...one, appCapable: true }])).toThrow("does not allow app mode");
  });
});

describe("pipeline definitions", () => {
  it("write only through ctx.output and ctx.payloads, never straight to a table or storage", () => {
    const dir = join(codeDir(import.meta.url), "definitions");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete|remove|upload)\(/);
      expect(src, f).not.toMatch(/\.rpc\(|\.storage\b|createClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});

describe("secrets", () => {
  it("names what each kind's real pipeline will read, with Claude and Gamma and no OpenAI", () => {
    const all = Object.values(PIPELINE_SECRETS).flat().map((s) => s.name);
    expect(new Set(all)).toEqual(new Set(["ANTHROPIC_API_KEY", "SPROUT_CLIENT_ID", "SPROUT_CLIENT_SECRET", "APIFY_API_TOKEN", "GAMMA_API_KEY", "RIVALIQ_API_KEY"]));
    expect(all.some((n) => /OPENAI/i.test(n))).toBe(false);
    // Every one is set on the project (APIFY_API_TOKEN and GAMMA_API_KEY since 20 Oct 2026).
    expect(Object.values(PIPELINE_SECRETS).flat().filter((s) => !s.set)).toEqual([]);
    expect(PIPELINE_SECRETS.linkedin_source.map((s) => s.name)).toEqual(["APIFY_API_TOKEN"]);
  });

  it("lists the ones the environment lacks", () => {
    expect(missingSecrets(["A", "B", "C"], (n) => ({ A: "x", B: " " } as Record<string, string>)[n])).toEqual(["B", "C"]);
  });
});
