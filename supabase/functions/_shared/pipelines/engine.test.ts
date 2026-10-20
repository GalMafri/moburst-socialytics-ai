// @vitest-environment node
// The engine switch and the pipeline registry: n8n unless a row asks for
// more and this deployment can do it; shadow per client (Moburst); app only
// with an app-capable pipeline whose secrets are set.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fakeDb } from "../lifecycle/fakeDb";
import { readEngine, requestedEngine, resolveEngine, type EngineRow } from "./engine";
import { makeRegistry, REGISTRY } from "./registry";
import { missingSecrets, PIPELINE_SECRETS } from "./secrets";
import type { PipelineDefinition } from "./types";

const MOBURST = "d00ce604-2bcc-455a-9826-f80250db75cf";
const OTHER = "11111111-1111-1111-1111-111111111111";
const DEFAULTS: EngineRow[] = [
  { kind: "social", client_id: null, engine: "n8n" },
  { kind: "competitive", client_id: null, engine: "n8n" },
  { kind: "linkedin_source", client_id: null, engine: "n8n" },
];
const noEnv = () => undefined;

const realSocial: PipelineDefinition = {
  name: "social_v1", kind: "social", modes: ["shadow", "app"], appCapable: true, secrets: ["ANTHROPIC_API_KEY", "GAMMA_API_KEY"], first: "a",
  steps: { a: async () => ({ type: "done" }) },
};

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

  it("is n8n with no rows, no table, or a value it does not know", () => {
    expect(requestedEngine([], "social", MOBURST)).toBe("n8n");
    expect(requestedEngine(null, "social", MOBURST)).toBe("n8n");
    expect(requestedEngine([{ kind: "social", client_id: null, engine: "lambda" }], "social", null)).toBe("n8n");
  });
});

describe("resolveEngine", () => {
  it("runs a shadow with the placeholder, which needs no secret", () => {
    const r = resolveEngine("shadow", "competitive", REGISTRY, noEnv);
    expect(r.engine).toBe("shadow");
    expect(r.pipeline?.name).toBe("placeholder_competitive");
  });

  it("refuses app while no app-capable pipeline of the kind has all its secrets set: n8n runs it", () => {
    for (const kind of ["social", "competitive", "linkedin_source"] as const) {
      const r = resolveEngine("app", kind, REGISTRY, noEnv);
      expect(r.engine).toBe("n8n");
      expect(r.refused).toContain("app-capable");
    }
  });

  it("takes app, and shadows with the real pipeline, once one is registered with its secrets set and a writer for the real report", () => {
    const registry = makeRegistry([...REGISTRY.all(), realSocial], (kind) => kind === "social");
    const env = (n: string) => ({ ANTHROPIC_API_KEY: "k", GAMMA_API_KEY: "g" } as Record<string, string>)[n];
    expect(resolveEngine("app", "social", registry, env)).toMatchObject({ engine: "app", pipeline: { name: "social_v1" } });
    expect(resolveEngine("shadow", "social", registry, env)).toMatchObject({ engine: "shadow", pipeline: { name: "social_v1" } });
  });

  it("refuses app while this deployment has no writer for the kind's real report", () => {
    const registry = makeRegistry([...REGISTRY.all(), realSocial]);
    const env = (n: string) => ({ ANTHROPIC_API_KEY: "k", GAMMA_API_KEY: "g" } as Record<string, string>)[n];
    expect(resolveEngine("app", "social", registry, env).engine).toBe("n8n");
    expect(resolveEngine("shadow", "social", registry, env).pipeline?.name).toBe("social_v1");
  });

  it("keeps a kind on n8n, and a shadow on the placeholder, while the real pipeline's secrets are missing", () => {
    const registry = makeRegistry([...REGISTRY.all(), realSocial], () => true);
    const env = (n: string) => (n === "ANTHROPIC_API_KEY" ? "k" : undefined);
    expect(resolveEngine("app", "social", registry, env).engine).toBe("n8n");
    expect(resolveEngine("shadow", "social", registry, env).pipeline?.name).toBe("placeholder_social");
  });

  it("shadows the LinkedIn source with the in-app pipeline while APIFY_API_TOKEN is missing (it waits), and takes app only once the token is set", () => {
    expect(resolveEngine("shadow", "linkedin_source", REGISTRY, noEnv)).toMatchObject({ engine: "shadow", pipeline: { name: "linkedin_source_v1" } });
    expect(resolveEngine("app", "linkedin_source", REGISTRY, noEnv).engine).toBe("n8n");
    const withToken = (n: string) => (n === "APIFY_API_TOKEN" ? "apify-token" : undefined);
    expect(resolveEngine("app", "linkedin_source", REGISTRY, withToken)).toMatchObject({ engine: "app", pipeline: { name: "linkedin_source_v1" } });
  });

  it("shadows the competitive analysis in-app once RivalIQ and Claude are set, and takes app only with the Apify token too", () => {
    const keys = (names: string[]) => (n: string) => (names.includes(n) ? "set" : undefined);
    expect(resolveEngine("shadow", "competitive", REGISTRY, keys(["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY"]))).toMatchObject({ engine: "shadow", pipeline: { name: "competitive_v1" } });
    expect(resolveEngine("app", "competitive", REGISTRY, keys(["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY"])).engine).toBe("n8n");
    expect(resolveEngine("app", "competitive", REGISTRY, keys(["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN"]))).toMatchObject({ engine: "app", pipeline: { name: "competitive_v1" } });
    // Social has no real pipeline yet: only its placeholder shadows, and app stays on n8n.
    expect(resolveEngine("app", "social", REGISTRY, keys(["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN"])).engine).toBe("n8n");
  });

  it("runs n8n for n8n", () => {
    expect(resolveEngine("n8n", "social", REGISTRY, noEnv)).toEqual({ engine: "n8n" });
  });
});

describe("readEngine", () => {
  const deps = { registry: REGISTRY, env: noEnv };
  it("reads the rows and resolves them", async () => {
    const db = fakeDb({ report_engines: [...DEFAULTS, { kind: "social", client_id: MOBURST, engine: "shadow" }] });
    expect((await readEngine(db, "social", MOBURST, deps)).engine).toBe("shadow");
    expect((await readEngine(db, "social", OTHER, deps)).engine).toBe("n8n");
  });

  it("is n8n when the table cannot be read or the read throws", async () => {
    const failing = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) };
    expect(await readEngine(failing, "social", MOBURST, deps)).toMatchObject({ engine: "n8n", refused: expect.stringContaining("relation does not exist") });
    const throwing = { from: () => { throw new Error("network"); } };
    expect((await readEngine(throwing, "competitive", MOBURST, deps)).engine).toBe("n8n");
  });
});

describe("registry", () => {
  it("registers the in-app LinkedIn source and competitive pipelines, and one shadow-only placeholder per kind, needing no secret", () => {
    expect(REGISTRY.all().map((d) => d.name).sort()).toEqual(["competitive_v1", "linkedin_source_v1", "placeholder_competitive", "placeholder_linkedin_source", "placeholder_social"]);
    for (const d of REGISTRY.all().filter((x) => x.name.startsWith("placeholder_"))) {
      expect(d.modes).toEqual(["shadow"]);
      expect(d.appCapable).toBe(false);
      expect(d.secrets).toEqual([]);
    }
    expect(REGISTRY.get("linkedin_source_v1")).toMatchObject({ kind: "linkedin_source", modes: ["shadow", "app"], appCapable: true, secrets: [], awaitedSecrets: ["APIFY_API_TOKEN"] });
    expect(REGISTRY.get("competitive_v1")).toMatchObject({ kind: "competitive", modes: ["shadow", "app"], appCapable: true, secrets: ["RIVALIQ_API_KEY", "ANTHROPIC_API_KEY"], awaitedSecrets: ["APIFY_API_TOKEN"] });
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
    const dir = join(dirname(fileURLToPath(import.meta.url)), "definitions");
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
    expect(PIPELINE_SECRETS.social.filter((s) => !s.set).map((s) => s.name)).toEqual(["APIFY_API_TOKEN", "GAMMA_API_KEY"]);
    expect(PIPELINE_SECRETS.linkedin_source.map((s) => s.name)).toEqual(["APIFY_API_TOKEN"]);
  });

  it("lists the ones the environment lacks", () => {
    expect(missingSecrets(["A", "B", "C"], (n) => ({ A: "x", B: " " } as Record<string, string>)[n])).toEqual(["B", "C"]);
  });
});
