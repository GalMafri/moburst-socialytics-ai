// The engine switch: which engine runs a report kind for a client.
//
// public.report_engines holds one row per kind (client_id null, the default
// for every client) and optional rows per kind and client, which win. Every
// default is n8n. Shadow is set per client only (the database refuses a
// kind-wide shadow): paid shadow runs are allowed for one client, Moburst
// (owner's decision, 20 Oct 2026).
//
// What runs is decided here, and anything in doubt is n8n, today's path:
// an unreadable table, an unknown value, a shadow with no pipeline whose
// secrets are set, an app with no app-capable pipeline in this deployment.
// The database refuses 'app' too, until an app-capable pipeline has finished
// a shadow run for the kind (report_engines_guard).

import { REGISTRY, type Registry } from "./registry.ts";
import type { Engine, PipelineDefinition, ReportKind } from "./types.ts";

export interface EngineRow {
  kind: string;
  client_id: string | null;
  engine: string;
}

const isEngine = (v: unknown): v is Engine => v === "n8n" || v === "app" || v === "shadow";

/** What the switch asks for: the client's own row, else the kind's row, else n8n. */
export function requestedEngine(rows: readonly EngineRow[] | null | undefined, kind: ReportKind, clientId: string | null): Engine {
  const forKind = (rows ?? []).filter((r) => r?.kind === kind);
  const own = clientId ? forKind.find((r) => r.client_id === clientId) : undefined;
  const fallback = forKind.find((r) => r.client_id == null);
  const value = (own ?? fallback)?.engine;
  return isEngine(value) ? value : "n8n";
}

export interface ResolvedEngine {
  engine: Engine;
  /** The in-app pipeline that runs, for shadow and app. */
  pipeline?: PipelineDefinition;
  /** Why the switch's value was not followed, for the logs. */
  refused?: string;
}

/** The engine that actually runs, given what this deployment can run. */
export function resolveEngine(requested: Engine, kind: ReportKind, registry: Registry, env: (name: string) => string | undefined): ResolvedEngine {
  if (requested === "n8n") return { engine: "n8n" };
  const pipeline = registry.forKind(kind, requested, env);
  if (!pipeline) {
    return {
      engine: "n8n",
      refused: requested === "app"
        ? `No app-capable ${kind} pipeline with its secrets set is in this deployment, so n8n runs it.`
        : `No ${kind} pipeline with its secrets set is in this deployment, so only n8n runs it.`,
    };
  }
  return { engine: requested, pipeline };
}

export interface EngineDeps {
  registry: Registry;
  env(name: string): string | undefined;
}

/** This deployment's pipelines and the function's environment. */
export function pipelineEngineDeps(): EngineDeps {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  return { registry: REGISTRY, env: (name) => (env ? env.get(name) : undefined) };
}

/** The engine for one run. Never throws: whatever goes wrong is n8n. */
// deno-lint-ignore no-explicit-any
export async function readEngine(db: any, kind: ReportKind, clientId: string | null, deps: EngineDeps): Promise<ResolvedEngine> {
  try {
    const { data, error } = await db.from("report_engines").select("kind, client_id, engine").eq("kind", kind);
    if (error) return { engine: "n8n", refused: `report_engines could not be read (${error.message}).` };
    const resolved = resolveEngine(requestedEngine(data as EngineRow[], kind, clientId), kind, deps.registry, deps.env);
    if (resolved.refused) console.warn(`[engine] ${kind} ${clientId ?? "default"}: ${resolved.refused}`);
    return resolved;
  } catch (e) {
    return { engine: "n8n", refused: `report_engines could not be read (${e instanceof Error ? e.message : String(e)}).` };
  }
}
