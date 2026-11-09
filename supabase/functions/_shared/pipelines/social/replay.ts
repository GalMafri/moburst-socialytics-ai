// Replay for the in-app social pipeline: a social run made again from what an
// earlier social run really read.
//
// Every social run keeps each provider answer it reads (KEPT below) for as
// long as the run itself is kept (SOURCE_KEEP_DAYS): the four Sprout reads,
// the stored industry trends it read, Claude's brief analysis, the analysis
// it accepted, the report's insights, and Gamma's last answer. A replay is a
// shadow run whose input names that earlier run (input.replay.from_run) and
// takes the same request; each step that would call a provider or read the
// trends reads the earlier run's answer instead, so every figure is computed
// again by the code that runs live. Gamma is never called in a replay (the
// earlier deck stands in), nor is the insights model (the earlier run's
// insights stand in). Claude's analyses are asked again only in a replay
// without reuse_analysis, which is a paid run and starts only for a client
// whose social switch is on shadow.
//
// A run made before stored trends (9 Nov 2026) read TikTok and Instagram
// through Apify, which a replay no longer reads: it replays with no trends,
// and the comparison leaves the trend keys out (harness.ts).

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
  /** The stored industry trends the run read, as { trends } (null for none). */
  trends: "source.trends",
  /** The report's insights as the run worded them (social/insights.ts), the row it stores. */
  insights: "source.insights",
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
