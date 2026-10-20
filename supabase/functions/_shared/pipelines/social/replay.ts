// Replay for the in-app social pipeline: a social run made again from what an
// earlier social run really read.
//
// Every social run keeps each provider answer it reads (KEPT below) for as
// long as the run itself is kept (SOURCE_KEEP_DAYS): the four Sprout reads,
// the two scraper datasets (or the scraper's failure), Claude's brief
// analysis, the analysis it accepted, and Gamma's last answer. A replay is a
// shadow run whose input names that earlier run (input.replay.from_run) and
// takes the same request; each step that would call a provider reads the
// earlier run's answer instead, so every figure is computed again by the code
// that runs live. Gamma is never called in a replay (the earlier deck stands
// in). Claude is called only for a replay without reuse_analysis, which is a
// paid run and starts only for a client whose social switch is on shadow.

import { makePayloadStore, SOURCE_KEEP_DAYS } from "../store.ts";
import type { StepContext } from "../types.ts";

/** What a replay run carries in its input (input.replay). */
export interface SocialReplay {
  /** The social run whose kept answers this one reads. */
  from_run: string;
  /** The report the result is compared with. */
  report_id: string | null;
  /** Use the earlier run's analyses instead of asking Claude: a figures comparison with no paid call. */
  reuse_analysis?: boolean;
}

/** The payload keys of the provider answers a social run keeps. */
export const KEPT = {
  brief: "source.brief",
  analysis: "source.analysis",
  gamma: "source.gamma",
  sprout: (read: string) => `source.sprout.${read}`,
  dataset: (source: "tiktok" | "instagram") => `source.${source}`,
  scraperFailed: (source: "tiktok" | "instagram") => `source.${source}.failed`,
} as const;

/** How a provider's answer is put: kept as long as its run. */
export const KEEP = { keepDays: SOURCE_KEEP_DAYS } as const;

export const replayOf = (ctx: StepContext): SocialReplay | null => ((ctx.run.input ?? {}) as { replay?: SocialReplay }).replay ?? null;

/** The earlier run's kept answer, read through the step's read-only database. */
export async function keptAnswer<T = unknown>(ctx: StepContext, key: string): Promise<T | null> {
  const replay = replayOf(ctx);
  if (!replay) throw new Error("Only a replay reads another run's answers.");
  return await makePayloadStore(ctx.db, replay.from_run).get<T>(key);
}
