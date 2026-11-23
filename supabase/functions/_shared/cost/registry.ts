/**
 * Every paid provider the Moburst tools call, and the only place their
 * addresses are written. Feature code never builds a provider URL: it calls
 * meteredFetch(ctx, provider, path, init) and the meter builds the URL from
 * here, so a paid call cannot leave the app without being recorded.
 *
 * The guardrail tests (supabase/functions/_shared/cost/guard.ts) fail when a
 * provider host appears in code outside this folder, or a provider key is
 * read outside the chokepoint. Adding a provider means adding it here, with
 * its key names and a price in pricing.ts. See CLAUDE.md.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "lovable_ai"
  | "apify"
  | "gamma"
  | "higgsfield"
  | "firecrawl"
  | "tribe"
  | "snowflake"
  | "jina";

export interface Provider {
  id: ProviderId;
  label: string;
  /** Base URL; a path is appended. "env:NAME" when the address comes from an env var (a self-hosted service). */
  base: string;
  /** Every host this provider is reached on, for the guardrail scan. */
  hosts: string[];
  /** Secret names (env vars or app_settings keys) that hold this provider's credentials. */
  keyNames: string[];
  /** How cost is known: the provider says it in dollars, we price usage, or we estimate. */
  costSource: "provider" | "priced" | "estimated";
  /** Whether the provider has a billing or usage API the daily reconciliation can read. */
  reconcile: "billing_api" | "credit_balance" | "none";
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: {
    id: "anthropic", label: "Anthropic", base: "https://api.anthropic.com",
    hosts: ["api.anthropic.com"], keyNames: ["ANTHROPIC_API_KEY", "ANTHROPIC_ADMIN_KEY", "anthropic_api_key"],
    costSource: "priced", reconcile: "billing_api",
  },
  openai: {
    id: "openai", label: "OpenAI", base: "https://api.openai.com",
    hosts: ["api.openai.com"], keyNames: ["OPENAI_API_KEY", "OPENAI_ADMIN_KEY", "openai_api_key"],
    costSource: "priced", reconcile: "billing_api",
  },
  gemini: {
    id: "gemini", label: "Google Gemini", base: "https://generativelanguage.googleapis.com",
    hosts: ["generativelanguage.googleapis.com"], keyNames: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_API_KEY", "gemini_api_key", "google_ai_api_key"],
    costSource: "priced", reconcile: "none",
  },
  lovable_ai: {
    id: "lovable_ai", label: "Lovable AI gateway", base: "https://ai.gateway.lovable.dev",
    hosts: ["ai.gateway.lovable.dev"], keyNames: ["LOVABLE_API_KEY"],
    costSource: "estimated", reconcile: "none",
  },
  apify: {
    id: "apify", label: "Apify", base: "https://api.apify.com",
    hosts: ["api.apify.com"], keyNames: ["APIFY_TOKEN", "APIFY_API_TOKEN"],
    costSource: "provider", reconcile: "billing_api",
  },
  gamma: {
    id: "gamma", label: "Gamma", base: "https://public-api.gamma.app",
    hosts: ["public-api.gamma.app"], keyNames: ["GAMMA_API_KEY"],
    costSource: "priced", reconcile: "credit_balance",
  },
  higgsfield: {
    id: "higgsfield", label: "Higgsfield", base: "https://mcp.higgsfield.ai",
    hosts: ["mcp.higgsfield.ai", "platform.higgsfield.ai", "api.higgsfield.ai"], keyNames: ["HIGGSFIELD_API_KEY", "HIGGSFIELD_API_KEY_ID", "HIGGSFIELD_API_KEY_SECRET", "HIGGSFIELD_CLIENT_ID", "HIGGSFIELD_CLIENT_SECRET"],
    costSource: "priced", reconcile: "credit_balance",
  },
  firecrawl: {
    id: "firecrawl", label: "Firecrawl", base: "https://api.firecrawl.dev",
    hosts: ["api.firecrawl.dev"], keyNames: ["FIRECRAWL_API_KEY"],
    costSource: "priced", reconcile: "credit_balance",
  },
  tribe: {
    id: "tribe", label: "TRIBE engagement model (Hugging Face Space GPU)", base: "env:TRIBE_API_URL",
    hosts: ["hf.space"], keyNames: ["HF_TOKEN", "TRIBE_API_URL"],
    costSource: "estimated", reconcile: "none",
  },
  snowflake: {
    id: "snowflake", label: "Snowflake (via Lovable connector gateway)", base: "https://connector-gateway.lovable.dev/snowflake",
    hosts: ["connector-gateway.lovable.dev"], keyNames: ["SNOWFLAKE_API_KEY"],
    costSource: "estimated", reconcile: "none",
  },
  jina: {
    id: "jina", label: "Jina Reader", base: "https://r.jina.ai",
    hosts: ["r.jina.ai"], keyNames: ["JINA_API_KEY"],
    costSource: "priced", reconcile: "none",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function providerUrl(id: ProviderId, path: string, env: (name: string) => string | undefined): string {
  const p = PROVIDERS[id];
  let base = p.base;
  if (base.startsWith("env:")) {
    const name = base.slice(4);
    base = env(name) ?? "";
    if (!base) throw new Error(`${name} is not set, so ${p.label} cannot be called`);
  }
  if (/^https?:\/\//i.test(path)) {
    // A full URL is accepted only on one of the provider's own hosts (an Apify dataset link, a Gamma file).
    const host = new URL(path).hostname;
    if (!p.hosts.some((h) => host === h || host.endsWith(`.${h}`)) && !(p.base.startsWith("env:") && path.startsWith(base))) {
      throw new Error(`${path} is not a ${p.label} address`);
    }
    return path;
  }
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
