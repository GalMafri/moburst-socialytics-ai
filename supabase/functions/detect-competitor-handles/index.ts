// Step 4: social handle + platform detection for a competitor set.
//
// For each competitor in the set (or one competitor when competitor_id is
// passed — used by the review UI's per-row "re-detect" action) this scrapes
// the competitor's website and pulls social profile links out of the HTML.
// That is deliberate: nearly every brand site links its own social profiles
// in the header/footer, it costs zero external API budget, and it never
// touches RivalIQ's 100-calls-per-hour pool. Handles land in
// competitor_handles with one row per (competitor, platform).
//
// Detection confidence: 0.9 when found on the brand's own site. Rows a human
// edits later keep whatever the human set (upsert only fills gaps unless
// `refresh` is true).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { extractSocialHandles, type DetectedHandle } from "../_shared/competitive/extractSocialHandles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchHtml(websiteUrl: string): Promise<string> {
  let url = websiteUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (resp.ok) return await resp.text();
  } catch { /* fall through to firecrawl */ }

  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) return "";
  try {
    const fcResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["html"], waitFor: 4000 }),
    });
    if (!fcResp.ok) return "";
    const fcData = await fcResp.json();
    return fcData.data?.html || fcData.html || "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { set_id, competitor_id, refresh } = await req.json();
    if (!set_id && !competitor_id) {
      return jsonResp({ error: "set_id or competitor_id is required" }, 400);
    }

    // Staff gate FIRST — before any query, so unauthenticated callers learn
    // nothing (not even whether an id exists). The per-client write check
    // follows once the rows tell us which client this is.
    const { asCaller } = await requireStaff(req);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase.from("competitors").select("id, client_id, name, website_url");
    query = competitor_id ? query.eq("id", competitor_id) : query.eq("set_id", set_id);
    const { data: competitors, error: compErr } = await query;
    if (compErr) throw new Error(compErr.message);
    if (!competitors || competitors.length === 0) {
      return jsonResp({ error: "No competitors found" }, 404);
    }

    // All rows in a set share a client; company-scoped staff must be allowed
    // to write THIS client.
    const { data: canWrite, error: writeErr } = await asCaller.rpc("can_write_client", {
      _client_id: competitors[0].client_id,
    });
    if (writeErr) throw new Error(`Access check failed: ${writeErr.message}`);
    if (!canWrite) return jsonResp({ error: "You do not have access to this client." }, 403);

    const results: Array<{ competitor_id: string; detected: DetectedHandle[] }> = [];

    // Serial on purpose: target sites are third parties, and a review set is
    // at most ~12 rows. Parallel fan-out buys seconds and risks rate limiting.
    for (const comp of competitors) {
      if (!comp.website_url) {
        results.push({ competitor_id: comp.id, detected: [] });
        continue;
      }
      const html = await fetchHtml(comp.website_url);
      const detected = html ? extractSocialHandles(html) : [];

      for (const h of detected) {
        if (refresh) {
          await supabase.from("competitor_handles").upsert(
            {
              competitor_id: comp.id,
              client_id: comp.client_id,
              platform: h.platform,
              handle: h.handle,
              profile_url: h.profile_url,
              is_active: true,
              detection_confidence: 0.9,
              detected_at: new Date().toISOString(),
            },
            { onConflict: "competitor_id,platform" },
          );
        } else {
          // Fill gaps only — never clobber a row a human may have edited.
          await supabase.from("competitor_handles").upsert(
            {
              competitor_id: comp.id,
              client_id: comp.client_id,
              platform: h.platform,
              handle: h.handle,
              profile_url: h.profile_url,
              is_active: true,
              detection_confidence: 0.9,
            },
            { onConflict: "competitor_id,platform", ignoreDuplicates: true },
          );
        }
      }
      results.push({ competitor_id: comp.id, detected });
    }

    return jsonResp({ results });
  } catch (err: unknown) {
    if (err instanceof AuthzError) {
      return jsonResp({ error: err.message }, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[detect-competitor-handles]", msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
