/**
 * The price list: one row per provider and model (or actor, or unit) from a
 * date. Data only; price.ts does the arithmetic.
 *
 * To change a price, ADD a row with the new effectiveFrom. Never edit or
 * delete a row that has been used: events keep the price_ref they were
 * priced with, and history must stay as it was.
 *
 * verified: true means the number was read on the provider's own pricing page
 * on the date in the note. verified: false means it is an estimate or depends
 * on Moburst's plan; the costs API shows which events used such rows.
 *
 * Events with no row here record cost_usd null and cost_source "unpriced", and
 * are counted in the API totals until a row is added. A new row prices events
 * from then on; it does not reprice earlier ones.
 *
 * Gamma, Higgsfield and the TRIBE Space are shared with other Moburst teams.
 * Their rows are the price of one unit (a credit, a GPU second), so a tool is
 * charged for what it used and never for the rest of the shared bill.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import type { PriceRow } from "./price.ts";

const M = 1_000_000;
const ANTHROPIC = "https://platform.claude.com/docs/en/about-claude/pricing";
const OPENAI = "https://developers.openai.com/api/docs/pricing";
const GEMINI = "https://aistudio.google.com/docs/pricing";
const READ = "Read on the provider page 2026-11-23.";

const claude = (resource: string, input: number, cacheWrite: number, cacheRead: number, output: number, note?: string): PriceRow => ({
  provider: "anthropic", resource, effectiveFrom: "2026-01-01",
  rates: {
    input_tokens: { usd: input, per: M },
    cache_write_tokens: { usd: cacheWrite, per: M },
    cache_read_tokens: { usd: cacheRead, per: M },
    output_tokens: { usd: output, per: M },
    web_searches: { usd: 10, per: 1000 },
  },
  modifiers: { batch: 0.5 },
  source: ANTHROPIC, verified: true, note: note ? `${READ} ${note}` : READ,
});

export const PRICES: readonly PriceRow[] = [
  // Anthropic, USD per million tokens; web search $10 per 1,000; Message Batches half price.
  claude("claude-opus-5-5", 4, 5, 0.2, 20),
  claude("claude-sonnet-5-5", 2, 2.5, 0.1, 10),
  claude("claude-haiku-5-5", 0.1, 0.125, 0.01, 0.5, "Prompts over 100k tokens bill 5x; not modelled."),
  claude("claude-sonnet-5", 2, 2.5, 0.2, 10),
  claude("claude-sonnet-4-6", 3, 3.75, 0.3, 15),
  claude("claude-haiku-4-5*", 1, 1.25, 0.1, 5, "Covers dated snapshots such as claude-haiku-4-5-20251001."),

  // OpenAI, USD per million tokens unless noted. Prefix rows also price dated snapshots.
  {
    provider: "openai", resource: "gpt-4o*", effectiveFrom: "2026-01-01",
    rates: { input_tokens: { usd: 2.5, per: M }, cache_read_tokens: { usd: 1.25, per: M }, output_tokens: { usd: 10, per: M } },
    source: OPENAI, verified: true, note: READ,
  },
  {
    provider: "openai", resource: "gpt-4.1*", effectiveFrom: "2026-01-01",
    rates: { input_tokens: { usd: 2, per: M }, cache_read_tokens: { usd: 0.5, per: M }, output_tokens: { usd: 8, per: M } },
    source: OPENAI, verified: true, note: READ,
  },
  {
    provider: "openai", resource: "text-embedding-3-small", effectiveFrom: "2026-01-01",
    rates: { input_tokens: { usd: 0.02, per: M } },
    source: OPENAI, verified: true, note: READ,
  },
  {
    provider: "openai", resource: "whisper-1", effectiveFrom: "2026-01-01",
    rates: { audio_seconds: { usd: 0.006, per: 60 } },
    source: OPENAI, verified: true, note: `${READ} $0.006 per minute.`,
  },
  {
    provider: "openai", resource: "gpt-image-2.5-flare*", effectiveFrom: "2026-09-08",
    rates: { input_tokens: { usd: 5, per: M }, image_input_tokens: { usd: 8, per: M }, output_tokens: { usd: 30, per: M } },
    source: "https://developers.openai.com/api/docs/models/gpt-image-2.5-flare", verified: true,
    note: `${READ} Cached-input rates do not apply to the Images API.`,
  },

  // Google Gemini API, paid tier. Output includes thinking tokens.
  {
    provider: "gemini", resource: "gemini-3-flash-preview", effectiveFrom: "2026-01-01",
    rates: { input_tokens: { usd: 0.5, per: M }, cache_read_tokens: { usd: 0.05, per: M }, output_tokens: { usd: 3, per: M } },
    source: GEMINI, verified: true, note: `${READ} Preview model; audio input bills $1.00.`,
  },
  {
    provider: "gemini", resource: "gemini-pro-latest", effectiveFrom: "2026-03-09",
    rates: { input_tokens: { usd: 2, per: M }, output_tokens: { usd: 12, per: M } },
    source: GEMINI, verified: false,
    note: "Alias; Google's changelog points it at gemini-3.1-pro-preview since 2026-03-09, priced as that model (<=200k context). Prompts over 200k bill $4/$18.",
  },
  {
    provider: "gemini", resource: "gemini-3.1-flash-image*", effectiveFrom: "2026-05-28",
    rates: { input_tokens: { usd: 0.5, per: M }, output_tokens: { usd: 60, per: M } },
    source: GEMINI, verified: true,
    note: `${READ} Image output tokens $60 per million. The -preview id was shut down 2026-06-25; calls to it fail.`,
  },

  // Lovable AI gateway: billed in Lovable credits with no published token formula.
  // Estimated at Google's own price for the same model until Lovable's credit usage is measured.
  {
    provider: "lovable_ai", resource: "google/gemini-3-flash-preview", effectiveFrom: "2026-01-01",
    rates: { input_tokens: { usd: 0.5, per: M }, cache_read_tokens: { usd: 0.05, per: M }, output_tokens: { usd: 3, per: M } },
    source: "https://docs.lovable.dev/features/usage-and-costs", verified: false,
    note: "Estimate at Google's direct price. Lovable bills credits ($0.30 each on Pro, $0.60 on Business) by an unpublished formula; compare with Settings > Plans & credit usage.",
  },

  // Firecrawl: 1 credit per scraped page, 2 per 10 search results. Standard plan $99 / 100k credits.
  {
    provider: "firecrawl", resource: "*", effectiveFrom: "2026-01-01",
    rates: { credits: { usd: 0.00099, per: 1 }, requests: { usd: 0.00099, per: 1 } },
    source: "https://www.firecrawl.dev/pricing", verified: false,
    note: "Standard plan rate; Moburst's plan may differ. A scrape reports no creditsUsed, so it counts as one credit.",
  },

  // Gamma: credits drawn from the key owner's balance. No Gamma charge was found in Mesh, so this is the
  // public top-up rate ($6 for 1,500 credits) until Moburst's plan is confirmed. A generation that reports
  // no credit count is priced at about what the first decks used (63 credits for 2 decks).
  {
    provider: "gamma", resource: "generation", effectiveFrom: "2026-11-24",
    rates: { credits: { usd: 0.004, per: 1 }, requests: { usd: 0.128, per: 1 } },
    source: "https://help.gamma.app/en/articles/12466653-how-to-purchase-more-credits", verified: false,
    note: "Public top-up rate, $0.004 a credit, read 2026-11-24. Moburst's Gamma plan is not confirmed (no Gamma charge found in Mesh).",
  },

  // Higgsfield: Moburst's team workspace ("scale" plan) pays $0.08 a credit: an auto top-up of 4,000 credits
  // was charged $320.00 on 2026-11-23 (Mesh, HIGGSFIELD INC.), and the plan reports 8 cents a credit.
  // Videos are recorded in the credits Higgsfield quoted; images as one image at the app's fixed 2k settings.
  {
    provider: "higgsfield", resource: "*", effectiveFrom: "2026-11-23",
    rates: { credits: { usd: 0.08, per: 1 } },
    source: "https://higgsfield.ai/pricing", verified: true,
    note: "Moburst's rate, $0.08 a credit: 4,000 credits for $320.00 on 2026-11-23 (Mesh) and price_per_credit_cents 8 on the team plan.",
  },
  {
    provider: "higgsfield", resource: "nano_banana_pro", effectiveFrom: "2026-11-23",
    rates: { images: { usd: 0.16, per: 1 }, credits: { usd: 0.08, per: 1 } },
    source: "https://higgsfield.ai/pricing", verified: true,
    note: "2 credits per 2k image (Higgsfield's quote, 2026-11-24) at $0.08 a credit. Re-quote if the app's resolution changes.",
  },
  {
    provider: "higgsfield", resource: "gpt_image_2_5", effectiveFrom: "2026-11-23",
    rates: { images: { usd: 0.18, per: 1 }, credits: { usd: 0.08, per: 1 } },
    source: "https://higgsfield.ai/pricing", verified: true,
    note: "2.25 credits per 2k high-quality image (Higgsfield's quote, 2026-11-24) at $0.08 a credit. Re-quote if the app's settings change.",
  },

  // TRIBE: the Hugging Face Space MoburstAI/tribe-v2-analyzer runs on an Nvidia T4 small, $0.40 an hour
  // (Mesh: about $10 from HUGGINGFACE every 25 hours). An analysis is charged for the seconds it ran.
  // The Space never sleeps, so its idle hours are a fixed overhead that no analysis is charged for.
  {
    provider: "tribe", resource: "tribe-space", effectiveFrom: "2026-10-01",
    rates: { gpu_seconds: { usd: 0.4, per: 3600 } },
    source: "https://huggingface.co/pricing", verified: true,
    note: "T4 small, $0.40 an hour, read 2026-11-24; the Space's hardware per the Hugging Face API. Busy time only.",
  },
  {
    provider: "tribe", resource: "tribe-space-estimate", effectiveFrom: "2026-10-01",
    rates: { gpu_seconds: { usd: 0.4, per: 3600 } },
    source: "https://huggingface.co/pricing", verified: false,
    note: "An analysis whose run time the server never sees (started from the browser), charged at the median run time of queued analyses.",
  },

  // Jina Reader without a key is free (20 requests a minute).
  {
    provider: "jina", resource: "reader", effectiveFrom: "2026-01-01",
    rates: { requests: { usd: 0, per: 1 } },
    source: "https://jina.ai/reader", verified: true, note: `${READ} Free without a key. Set a price here if a key is added.`,
  },

  // Snowflake through the Lovable connector: X-Small warehouse, 1 credit an hour, Enterprise $3 a credit.
  {
    provider: "snowflake", resource: "warehouse", effectiveFrom: "2026-01-01",
    rates: { warehouse_seconds: { usd: 3, per: 3600 } },
    source: "https://www.snowflake.com/pricing/pricing-guide/", verified: false,
    note: "Assumes an X-Small warehouse on Enterprise in AWS US. Real cost includes the 60 s minimum per resume and idle time before suspend.",
  },
];
