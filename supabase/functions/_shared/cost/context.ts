/**
 * Who a paid call is for. Every metered call takes one of these as its first
 * argument, so a call without attribution does not compile.
 *
 * A call is charged to one of three buckets:
 *   client  the call did work for clientId (whoever ran it, paying or not)
 *   shared  the call serves every client at once (a global sync, benchmarks);
 *           only features listed in SHARED_FEATURES may say so
 *   dev_qa  testing and internal spend: QA scripts, smoke runs, and any call
 *           that arrived without a client (flagged unattributed, never dropped)
 *
 * A client marked as a test account (clients.exclude_from_reporting) is
 * re-bucketed at read time, so marking one later moves its history too.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */

export type Tool = "advisor" | "socialytics";
export type Actor = "user" | "schedule" | "system" | "api";
export type BucketHint = "client" | "shared" | "dev_qa";

export interface CostContext {
  tool: Tool;
  /** The app's clients.id, or null when the work is for no client. */
  clientId: string | null;
  /** A stable label for what is being done, e.g. "weekly_report.vision". Lowercase, dots and underscores. */
  feature: string;
  /** The same execution id the gOS usage events carry, so the portal can join cost to runs. */
  executionId?: string | null;
  actor: Actor;
  /** The person who started the work, when one did. */
  userId?: string | null;
  /** The API key that started the work, when one did. */
  apiKeyId?: string | null;
  /** Set only by QA and smoke scripts: everything they spend is dev/QA. */
  qa?: boolean;
}

const FEATURE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

export class CostContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostContextError";
  }
}

/** Throws when the context cannot be recorded as given (a malformed feature label). */
export function checkContext(ctx: CostContext): void {
  if (!ctx || typeof ctx !== "object") throw new CostContextError("A paid call needs a CostContext");
  if (!FEATURE.test(ctx.feature ?? "")) throw new CostContextError(`Feature label "${ctx.feature}" must be lowercase words joined by dots or underscores`);
  if (ctx.tool !== "advisor" && ctx.tool !== "socialytics") throw new CostContextError(`Unknown tool "${String(ctx.tool)}"`);
}

/**
 * Which bucket the call goes to, before the read-time test-client flag, and
 * whether it arrived without a client it should have had.
 */
export function bucketOf(ctx: CostContext, sharedFeatures: ReadonlySet<string>): { hint: BucketHint; unattributed: boolean } {
  if (ctx.qa) return { hint: "dev_qa", unattributed: false };
  if (ctx.clientId) return { hint: "client", unattributed: false };
  if (sharedFeatures.has(ctx.feature) || [...sharedFeatures].some((f) => f.endsWith(".*") && ctx.feature.startsWith(f.slice(0, -1)))) {
    return { hint: "shared", unattributed: false };
  }
  return { hint: "dev_qa", unattributed: true };
}
