// The secrets the in-app report pipelines read, by the exact name each one is
// read under (Deno.env.get). A pipeline lists what it reads in its
// definition, and a pipeline whose secrets are not all set is never chosen
// (engine.ts), so a missing key keeps that kind on n8n instead of failing.
// A secret a pipeline lists as awaited (APIFY_API_TOKEN, until the owner adds
// it) does not keep a shadow from being chosen: its step waits for it quietly
// and says so in the step log. App mode needs every one of them set.
//
// Owner's decisions, 20 Oct 2026: the in-app pipelines call Claude through
// _shared/anthropic.ts (no OpenAI); the social report keeps its Gamma deck,
// made from the existing template.

import type { ReportKind } from "./types.ts";

export interface SecretNeed {
  name: string;
  /** Already set on the project (read by other functions today). */
  set: boolean;
  why: string;
}

export const ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY";
/** Apify API token: the TikTok and Instagram trend scrapers and the LinkedIn company-posts actor (harvestapi/linkedin-company-posts). */
export const APIFY_API_TOKEN = "APIFY_API_TOKEN";
/** Gamma API key, sent as X-API-KEY to public-api.gamma.app/v1.0 (generation from the existing template, then its status). */
export const GAMMA_API_KEY = "GAMMA_API_KEY";
export const RIVALIQ_API_KEY = "RIVALIQ_API_KEY";
export const SPROUT_CLIENT_ID = "SPROUT_CLIENT_ID";
export const SPROUT_CLIENT_SECRET = "SPROUT_CLIENT_SECRET";

/** What each kind's real pipeline will read once it is built. */
export const PIPELINE_SECRETS: Record<ReportKind, SecretNeed[]> = {
  social: [
    { name: ANTHROPIC_API_KEY, set: true, why: "the brief analysis and the report synthesis (n8n uses OpenAI and Gemini nodes for these)" },
    { name: SPROUT_CLIENT_ID, set: true, why: "Sprout analytics for the month and the month before" },
    { name: SPROUT_CLIENT_SECRET, set: true, why: "Sprout analytics for the month and the month before" },
    { name: APIFY_API_TOKEN, set: true, why: "the TikTok and Instagram trend scrapers" },
    { name: GAMMA_API_KEY, set: true, why: "the report deck, generated from the existing Gamma template and polled until ready" },
  ],
  competitive: [
    { name: RIVALIQ_API_KEY, set: true, why: "landscape status, companies, social posts and metrics" },
    { name: ANTHROPIC_API_KEY, set: true, why: "the competitive analysis (n8n uses an OpenAI node for it)" },
    { name: APIFY_API_TOKEN, set: true, why: "the LinkedIn company posts the analysis adds to RivalIQ's" },
  ],
  linkedin_source: [
    { name: APIFY_API_TOKEN, set: true, why: "the LinkedIn company-posts actor the n8n workflow runs" },
  ],
};

/** The names a pipeline reads that the environment does not have. */
export function missingSecrets(names: readonly string[], env: (name: string) => string | undefined): string[] {
  return names.filter((n) => !String(env(n) ?? "").trim());
}
