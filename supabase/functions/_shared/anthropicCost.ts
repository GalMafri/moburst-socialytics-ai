// The cost context for an Anthropic call that cannot go on without the key.
// Kept apart from anthropic.ts so a test that stands in for the model calls
// still gets the real check.

import type { CostContext } from "./cost/context.ts";
import { costCtx, hasKey } from "./paid/index.ts";

/**
 * Throws "ANTHROPIC_API_KEY is not configured." when the paying desk has no
 * key, as the jobs that read the key themselves always did; otherwise the
 * context the call is recorded against.
 */
export async function anthropicCost(c: Parameters<typeof costCtx>[0]): Promise<CostContext> {
  if (!(await hasKey("anthropic"))) throw new Error("ANTHROPIC_API_KEY is not configured.");
  return costCtx(c);
}
