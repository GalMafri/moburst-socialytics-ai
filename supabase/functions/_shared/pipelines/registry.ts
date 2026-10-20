// Every in-app pipeline this deployment can run. A run names its pipeline;
// a run whose pipeline is not here (a rollback, say) stops quietly, and for a
// report the dispatch then makes it again on n8n.

import { PLACEHOLDER_PIPELINES } from "./definitions/placeholder.ts";
import { missingSecrets } from "./secrets.ts";
import { REAL_WRITERS } from "./store.ts";
import type { PipelineDefinition, ReportKind, RunMode } from "./types.ts";

export interface Registry {
  get(name: string): PipelineDefinition | undefined;
  /**
   * The pipeline a kind runs in a mode, with all its secrets set: an
   * app-capable one first (the real pipeline, shadowed before it goes live),
   * else any other the mode allows (a placeholder). App mode takes only an
   * app-capable one.
   */
  forKind(kind: ReportKind, mode: RunMode, env: (name: string) => string | undefined): PipelineDefinition | undefined;
  all(): readonly PipelineDefinition[];
}

/**
 * canWriteReal says whether this deployment has a writer for a kind's real
 * report (store.ts REAL_WRITERS); without one, no pipeline of that kind can
 * run in app mode, however it is marked.
 */
export function makeRegistry(defs: readonly PipelineDefinition[], canWriteReal: (kind: ReportKind) => boolean = () => false): Registry {
  const byName = new Map<string, PipelineDefinition>();
  for (const d of defs) {
    if (byName.has(d.name)) throw new Error(`Two pipelines are named ${d.name}.`);
    if (!d.steps[d.first]) throw new Error(`Pipeline ${d.name} starts at ${d.first}, which it does not define.`);
    if (d.appCapable && !d.modes.includes("app")) throw new Error(`Pipeline ${d.name} is app-capable but does not allow app mode.`);
    byName.set(d.name, d);
  }
  return {
    get: (name) => byName.get(name),
    forKind(kind, mode, env) {
      const usable = defs.filter((d) => d.kind === kind && d.modes.includes(mode) && missingSecrets(d.secrets, env).length === 0);
      const real = usable.find((d) => d.appCapable);
      if (mode === "app") return real && canWriteReal(kind) ? real : undefined;
      return real ?? usable[0];
    },
    all: () => defs,
  };
}

/** What this deployment registers: the placeholders, until the real pipelines are built. */
export const REGISTRY: Registry = makeRegistry([...PLACEHOLDER_PIPELINES], (kind) => Boolean(REAL_WRITERS[kind]?.report));
