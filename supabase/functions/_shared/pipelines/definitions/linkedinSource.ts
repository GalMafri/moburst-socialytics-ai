// The LinkedIn source pipeline (kind linkedin_source): the in-app port of
// n8n "Socialytics - Verified LinkedIn Source" (xm3ZFPjysyQCkWsc, live
// version 29ba2340). One step, called back while the actor runs:
//
//   collect  checks the request (Prepare Source Request), runs
//            harvestapi/linkedin-company-posts with the same input and limits
//            (150 posts a page, from the period's first day, no comments,
//            reactions or reposts, quote posts kept; 240 s, 512 MB), keeps
//            the raw dataset, checks every row (Verify Source Posts) and
//            writes the answer n8n's webhook gives, which
//            _shared/competitive/linkedinSource.ts reads.
//
// Shadow: the answer goes to shadow_linkedin_sources, next to what n8n
// answered (kept with the run as real.output). App: the competitor feed
// refresh runs this pipeline in-process (inline.ts) and uses the answer; the
// answer is also kept with the run.
//
// While APIFY_API_TOKEN is not set the step waits quietly (apifyStep.ts).

import { runActorStep, type ApifyFactory } from "../apifyStep.ts";
import { linkedInSourceAnswer, LINKEDIN_ACTOR, prepareSourceRequest, verifyLinkedInRows } from "../linkedin/sources.ts";
import { APIFY_API_TOKEN } from "../secrets.ts";
import type { PipelineDefinition } from "../types.ts";

export const LINKEDIN_SOURCE_PIPELINE = "linkedin_source_v1";

export function linkedInSourcePipeline(deps: { apify?: ApifyFactory } = {}): PipelineDefinition {
  return {
    name: LINKEDIN_SOURCE_PIPELINE,
    kind: "linkedin_source",
    modes: ["shadow", "app"],
    appCapable: true,
    secrets: [],
    awaitedSecrets: [APIFY_API_TOKEN],
    first: "collect",
    steps: {
      async collect(ctx) {
        const input = (ctx.run.input ?? {}) as { sources?: unknown; period?: { start?: string; end?: string } };
        const plan = prepareSourceRequest({ sources: input.sources, period: input.period });
        const actor = await runActorStep(ctx, { actor: LINKEDIN_ACTOR, input: plan.input, datasetKey: "apify.dataset", apify: deps.apify });
        if (actor.type === "wait") return actor.result;
        const verified = verifyLinkedInRows(actor.rows, plan, { today: ctx.now().toISOString().slice(0, 10) });
        const answer = linkedInSourceAnswer(plan, verified);
        await ctx.output.write("report", answer);
        return { type: "done", detail: { apify_run_id: actor.runId, items: actor.rows.length, posts: answer.linkedin_posts, sources: plan.sources.length } };
      },
    },
  };
}
