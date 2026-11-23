// supabase/functions/_shared/paid/config.ts
//
// Socialytics' side of cost tracking: what the shared guardrails need to know
// about this app. Read by _shared/paid/index.ts and by
// supabase/tests/paid/cost-guard.test.ts. See CLAUDE.md, "Paid calls and cost
// tracking".

import type { ApifyActors } from "../cost/apify.ts";

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
  COST_WEBHOOK_SECRET: "authenticates Apify's run webhooks to cost-apify-webhook, not a provider key",
};

/**
 * The Apify actors Socialytics runs. The account is shared with AdVisor and
 * n8n, so the daily audit (cost/audit.ts) records a run nobody recorded only
 * when its actor is owned here; a run of a shared or unknown actor goes to
 * cost_unclaimed_runs for review. The cost-guard test fails when the code runs
 * an actor that is on neither list.
 *
 * owned   only Socialytics runs it
 * shared  another Moburst tool on the account may run it too (generic actors)
 */
export const APIFY_ACTORS: ApifyActors = {
  owned: [
    { name: "apidojo/tiktok-scraper", id: "5K30i8aFccKNF5ICs", note: "trends: TikTok" },
    { name: "apify/instagram-hashtag-scraper", id: "reGe1ST3OBgYZSsZJ", note: "trends: Instagram" },
    { name: "harvestapi/linkedin-post-search", id: "buIWk2uOUzTmcLsuB", note: "trends: LinkedIn" },
    { name: "api-ninja/youtube-search-scraper", id: "nfyn3ecod9uCDaoVH", note: "trends: YouTube" },
    { name: "epctex/pinterest-scraper", id: "rusvWpGtw0MugV2j4", note: "trends: Pinterest" },
    { name: "scraper_one/facebook-posts-search", id: "TMBawM4LZpKN15DZX", note: "trends: Facebook" },
    { name: "harvestapi/linkedin-company-posts", id: "WI0tj4Ieb5Kq458gB", note: "social and competitive reports, competitor feed: LinkedIn posts" },
    { name: "apify/instagram-profile-scraper", note: "onboarding: Instagram profile" },
    { name: "harvestapi/linkedin-company", note: "onboarding: LinkedIn page" },
  ],
  // Generic actors another Moburst tool on the account may run (the same list as AdVisor's).
  shared: [
    { name: "apify/website-content-crawler", note: "generic crawler (AdVisor runs it)" },
    { name: "apify/rag-web-browser", note: "generic" },
    { name: "apify/web-scraper", note: "generic" },
    { name: "apify/cheerio-scraper", note: "generic" },
    { name: "apify/playwright-scraper", note: "generic" },
    { name: "apify/puppeteer-scraper", note: "generic" },
  ],
};
