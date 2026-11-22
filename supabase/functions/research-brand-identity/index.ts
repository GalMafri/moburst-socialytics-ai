// Read a brand from its website for the setup page. The read itself lives in
// _shared/brand/research.ts, which the client lifecycle's brand_read step
// runs on the server; this function answers the page with the same result
// and writes nothing.
import { createClient } from "../_shared/supabase.ts";
import { staffGate } from "../_shared/auth/requireStaff.ts";
import { openaiKeyFor, ResearchError, researchBrand } from "../_shared/brand/research.ts";
import { htmlLanguage, resolveLocation } from "../_shared/lifecycle/location.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Fetches any URL it is handed and spends model credits on our key, so it
  // cannot be world-invokable.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

  try {
    const { website_url, client_name } = await req.json();
    if (!website_url) return jsonResponse({ error: "website_url is required" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const openaiKey = await openaiKeyFor(db);
    if (!openaiKey) return jsonResponse({ error: "OpenAI API key not configured." }, 400);

    const read = await researchBrand({
      websiteUrl: website_url,
      clientName: client_name,
      openaiKey,
      firecrawlKey: Deno.env.get("FIRECRAWL_API_KEY") ?? null,
    });
    const location = resolveLocation(read.html, { headquarters: read.headquarters, website: read.url });
    return jsonResponse({
      brand_identity: read.brand_identity,
      logo_url: read.logo && "url" in read.logo ? read.logo.url : null,
      location: { ...location, language: htmlLanguage(read.html).language ?? read.site_language },
      _debug: read.debug,
    });
  } catch (err) {
    if (err instanceof ResearchError) {
      // QA 22 Nov 2026 (P58-03): a model that did not finish the read was
      // answered 502, which the setup page sends again (any 5xx), paying for a
      // crawl and a model call each time. It is answered as a refusal the page
      // does not resend; the page says the site has not been read yet.
      return jsonResponse({ error: err.message, code: err.code }, err.code === "model" ? 422 : 400);
    }
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
