// The engine switch: which engine runs a report kind for a client.
//
// public.report_engines holds one row per kind (client_id null, the default
// for every client) and optional rows per kind and client, which win. Shadow
// is set per client only (the database refuses a kind-wide shadow): paid
// shadow runs are allowed for one client, Moburst (owner's decision, 20 Oct
// 2026). The database refuses 'app' until an app-capable pipeline has
// finished a shadow run for the kind (report_engines_guard).
//
// What runs is decided here. n8n runs only where a row asks for it (set by
// hand, so the switch can be turned back until the n8n paths are removed);
// shadow asks for n8n too, with an in-app run next to it. Everything else is
// app, the in-app pipeline, and nothing in doubt is ever handed to n8n. A
// missing row or an unknown value is app, with its pipeline when one can run.
// A switch that cannot be read, or an app with no app-capable pipeline whose
// secrets are set in this deployment, is app with no pipeline, which the
// callers read as "not now": the dispatch runs the report again later; the
// feed refresh saves the feed without LinkedIn posts and the feed job
// collects them again 10 minutes later.

import { REGISTRY, type Registry } from "./registry.ts";
import type { Engine, PipelineDefinition, ReportKind } from "./types.ts";

export interface EngineRow {
  kind: string;
  client_id: string | null;
  engine: string;
}

const isEngine = (v: unknown): v is Engine => v === "n8n" || v === "app" || v === "shadow";

/** What the switch asks for: the client's own row, else the kind's row, else app. */
export function requestedEngine(rows: readonly EngineRow[] | null | undefined, kind: ReportKind, clientId: string | null): Engine {
  const forKind = (rows ?? []).filter((r) => r?.kind === kind);
  const own = clientId ? forKind.find((r) => r.client_id === clientId) : undefined;
  const fallback = forKind.find((r) => r.client_id == null);
  const value = (own ?? fallback)?.engine;
  return isEngine(value) ? value : "app";
}

export interface ResolvedEngine {
  engine: Engine;
  /**
   * The in-app pipeline that runs: the shadow's, or the one that makes the
   * report. An app with none cannot run now (see refused); a shadow with
   * none runs n8n alone.
   */
  pipeline?: PipelineDefinition;
  /** Why no pipeline runs, for the logs. */
  refused?: string;
  /** The switch itself could not be read (as opposed to a pipeline that cannot run here). */
  unreadable?: boolean;
}

/** The engine that actually runs, given what this deployment can run. */
export function resolveEngine(requested: Engine, kind: ReportKind, registry: Registry, env: (name: string) => string | undefined): ResolvedEngine {
  if (requested === "n8n") return { engine: "n8n" };
  const pipeline = registry.forKind(kind, requested, env);
  if (!pipeline) {
    return {
      engine: requested,
      refused: requested === "app"
        ? `No app-capable ${kind} pipeline with its secrets set is in this deployment.`
        : `No ${kind} pipeline with its secrets set is in this deployment to run next to n8n.`,
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

/**
 * The engine for one run. Never throws. A switch that cannot be read is app
 * with no pipeline: whether a row asks for n8n is not known, so nothing runs
 * now and the caller tries again later.
 */
// deno-lint-ignore no-explicit-any
export async function readEngine(db: any, kind: ReportKind, clientId: string | null, deps: EngineDeps): Promise<ResolvedEngine> {
  const unreadable = (why: string): ResolvedEngine => {
    const refused = `The engine switch could not be read (${why}).`;
    console.warn(`[engine] ${kind} ${clientId ?? "default"}: ${refused}`);
    return { engine: "app", refused, unreadable: true };
  };
  try {
    const { data, error } = await db.from("report_engines").select("kind, client_id, engine").eq("kind", kind);
    if (error) return unreadable(error.message);
    const resolved = resolveEngine(requestedEngine(data as EngineRow[], kind, clientId), kind, deps.registry, deps.env);
    if (resolved.refused) console.warn(`[engine] ${kind} ${clientId ?? "default"}: ${resolved.refused}`);
    return resolved;
  } catch (e) {
    return unreadable(e instanceof Error ? e.message : String(e));
  }
}
