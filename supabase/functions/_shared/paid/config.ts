// supabase/functions/_shared/paid/config.ts
//
// Socialytics' side of cost tracking: what the shared guardrails need to know
// about this app. Read by _shared/paid/index.ts and by
// supabase/tests/paid/cost-guard.test.ts. See CLAUDE.md, "Paid calls and cost
// tracking".

export const TOOL = "socialytics" as const;

/** Repo paths that make up the chokepoint: the only code allowed to name a provider or read its key. */
export const CHOKEPOINT = ["supabase/functions/_shared/cost/", "supabase/functions/_shared/paid/"];

/** Scripts whose spend is dev/QA by design (they pass qa: true). */
export const QA_PATHS = ["scripts/qa/", "scripts/smoke"];

/**
 * Features that serve every client at once, so they are charged to the
 * shared bucket instead of a client. Only list a feature here when no client
 * asked for the work. ".*" covers a feature and everything under it.
 */
export const SHARED_FEATURES: ReadonlySet<string> = new Set([
  "platform_sizes.refresh",    // the platform image-size table, the same for every client
  "moments.list",              // the shared calendar of cultural moments
  "higgsfield.account",        // the team account's credit balance and price quotes: free reads, no client's work
]);

/** Strings that look like model ids but are not models (labels, step names). */
export const NOT_MODELS: ReadonlySet<string> = new Set(["claude-direct"]);

/**
 * Secrets that are NOT paid-per-call providers' keys, each with why. A secret
 * read anywhere in the code must be here or in cost/registry.ts; a new one
 * fails the cost-guard test until someone decides which it is.
 */
export const NOT_PAID_SECRETS: Record<string, string> = {
  SUPABASE_SERVICE_ROLE_KEY: "our own database",
  SUPABASE_ANON_KEY: "our own database, public key",
  SOCIALYTICS_N8N_SECRET: "internal cron and function-to-function secret",
  SOCIALYTICS_AGENT_KEY: "internal agent key",
  RIVALIQ_API_KEY: "RivalIQ is a flat monthly subscription, not billed per call",
  SPROUT_CLIENT_ID: "Sprout Social is a flat subscription",
  SPROUT_CLIENT_SECRET: "Sprout Social is a flat subscription",
  CANVA_CLIENT_ID: "Canva Connect is not billed per call",
  CANVA_CLIENT_SECRET: "Canva Connect is not billed per call",
  MOBTOOLS_TOOL_TOKEN: "gOS Auth Service token (moburst.ai), not metered",
};
