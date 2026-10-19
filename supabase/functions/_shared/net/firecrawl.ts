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
