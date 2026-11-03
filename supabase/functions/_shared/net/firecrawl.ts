// supabase/functions/_shared/net/firecrawl.ts
//
// A page's main text as markdown through Firecrawl (one credit), for the
// client lifecycle's site brief. The firecrawl-scrape function is the same
// request for the setup page.

export async function scrapeMarkdown(url: string, opts: { apiKey?: string | null; fetchImpl?: typeof fetch } = {}): Promise<{ markdown: string; title: string | null } | null> {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  const key = opts.apiKey ?? env?.get("FIRECRAWL_API_KEY");
  if (!key) return null;
  const f = opts.fetchImpl ?? fetch;
  try {
    const response = await f("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
export async function searchWeb(query: string, opts: { apiKey?: string | null; fetchImpl?: typeof fetch; limit?: number } = {}): Promise<string[]> {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  const key = opts.apiKey ?? env?.get("FIRECRAWL_API_KEY");
  if (!key) return [];
  const f = opts.fetchImpl ?? fetch;
  try {
    const response = await f("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
