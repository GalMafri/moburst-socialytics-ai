// supabase/functions/_shared/net/firecrawl.ts
//
// A page's main text as markdown through Firecrawl (one credit), for the
// client lifecycle's site brief, and a web search. Both go through the paying
// desk (_shared/paid), which adds the key and records the credits against
// `cost`. Without the key (FIRECRAWL_API_KEY) the desk refuses the call, and
// each answers nothing, as before.

import type { CostContext } from "../cost/context.ts";
import { paid } from "../paid/index.ts";

export async function scrapeMarkdown(cost: CostContext, url: string): Promise<{ markdown: string; title: string | null } | null> {
  try {
    const response = await paid.fetch(cost, "firecrawl", "/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: /^https?:\/\//i.test(url) ? url : `https://${url}`, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.success === false) return null;
    return { markdown: String(data?.data?.markdown ?? ""), title: data?.data?.metadata?.title ? String(data.data.metadata.title) : null };
  } catch {
    return null;
  }
}

/**
 * A web search through Firecrawl (2 credits per 10 results): the result
 * addresses in their order, or none when it does not answer. The lifecycle's
 * website step searches a brand's name this way, as competitive/
 * detectHandles.ts searches for profiles.
 */
export async function searchWeb(cost: CostContext, query: string, opts: { limit?: number } = {}): Promise<string[]> {
  try {
    const response = await paid.fetch(cost, "firecrawl", "/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.replace(/[\r\n]+/g, " ").slice(0, 200), limit: opts.limit ?? 10 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (data?.success === false) return [];
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.web) ? data.data.web : [];
    return rows.map((r: { url?: unknown }) => (typeof r?.url === "string" ? r.url : "")).filter(Boolean);
  } catch {
    return [];
  }
}
