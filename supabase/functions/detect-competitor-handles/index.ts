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
import { extractSocialHandles, mergeHandles, type DetectedHandle } from "../_shared/competitive/extractSocialHandles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function normalizeUrl(websiteUrl: string): string {
  const url = websiteUrl.trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

async function fetchDirect(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
      redirect: "follow",
      // A site that never answers used to hold the whole set behind it.
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      console.log(`[detect] ${resp.status} ${url}`);
      return "";
    }
    return await resp.text();
  } catch (e) {
    console.log(`[detect] fetch failed ${url}: ${(e as Error)?.name || e}`);
    return "";
  }
}

/**
 * The rendered page, plus the links Firecrawl found on it.
 *
 * Two things were wrong with asking for `html` alone: Firecrawl defaults to
 * onlyMainContent, which throws away the footer — exactly where a brand puts
 * its social links — and the HTML still has to be parsed. The `links` array
 * is the footer's hrefs already extracted, whatever JavaScript built them.
 */
async function fetchRendered(url: string): Promise<string> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    console.log("[detect] no FIRECRAWL_API_KEY; skipping the rendered pass");
    return "";
  }
  try {
    const fcResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml", "links"], onlyMainContent: false, waitFor: 4000, timeout: 20000 }),
    });
    if (!fcResp.ok) {
      console.log(`[detect] firecrawl ${fcResp.status} for ${url}: ${(await fcResp.text().catch(() => "")).slice(0, 200)}`);
      return "";
    }
    const fcData = await fcResp.json();
    const html = fcData.data?.rawHtml || fcData.data?.html || fcData.rawHtml || fcData.html || "";
    const links: string[] = fcData.data?.links || fcData.links || [];
    // The links go in as plain text; the extractor treats them as URLs.
    return `${html}\n${links.join("\n")}`;
  } catch (e) {
    console.log(`[detect] firecrawl threw for ${url}: ${(e as Error)?.message || e}`);
    return "";
  }
}

/**
 * Last resort: ask the web where the brand's profile is.
 *
 * A brand whose site links nothing (a one-page builder site, an app-store
 * landing page) still has profiles, and a site: search finds them. Only the
 * platforms still missing are searched, and the results are written at a
 * lower confidence so a person can tell them apart.
 */
async function searchForHandles(brandName: string, missing: string[]): Promise<DetectedHandle[]> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey || !brandName || missing.length === 0) return [];
  const SITE: Record<string, string> = {
    instagram: "instagram.com",
    facebook: "facebook.com",
    tiktok: "tiktok.com",
    linkedin: "linkedin.com",
    youtube: "youtube.com",
    x: "x.com",
  };
  const out: DetectedHandle[] = [];
  for (const platform of missing.slice(0, 4)) {
    const site = SITE[platform];
    if (!site) continue;
    try {
      const resp = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: `"${brandName}" site:${site}`, limit: 5 }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const urls: string[] = (data.data || data.results || []).map((r: any) => r.url).filter(Boolean);
      const hits = extractSocialHandles(urls.join("\n"), brandName).filter((h) => h.platform === platform);
      if (hits[0]) out.push(hits[0]);
    } catch {
      // A search that fails leaves the platform empty, which is the honest answer.
    }
  }
  return out;
}

/** Pages that carry the social links when the homepage does not. */
const FALLBACK_PATHS = ["/contact", "/about", "/about-us", "/company"];

/**
 * Everything this brand links to, from wherever on its site it links it.
 *
 * The homepage alone was the whole search, and it answered "no handles
 * detected yet" for two kinds of site that are common: the ones that render
 * their footer in JavaScript, where the HTML comes back 200 and empty of
 * links, and the ones that keep their social links on a contact page. A 200
 * with nothing in it now falls through to a rendered fetch, and then to the
 * handful of pages a brand puts its links on, rather than being read as an
 * answer.
 */
const ALL_PLATFORMS = ["instagram", "facebook", "tiktok", "linkedin", "youtube", "x"];

async function detectForSite(websiteUrl: string, brandName?: string): Promise<DetectedHandle[]> {
  const base = normalizeUrl(websiteUrl);
  const groups: DetectedHandle[][] = [];
  const missing = () => ALL_PLATFORMS.filter((p) => !groups.some((g) => g.some((h) => h.platform === p)));

  // Every source is read and merged. Returning on the first non-empty result
  // meant one LinkedIn badge in the raw HTML suppressed the rendered pass and
  // the contact pages, so a brand with five profiles was recorded as having
  // one.
  const direct = await fetchDirect(base);
  if (direct) groups.push(extractSocialHandles(direct, brandName));

  if (missing().length > 0) {
    const rendered = await fetchRendered(base);
    if (rendered) groups.push(extractSocialHandles(rendered, brandName));
  }

  for (const path of FALLBACK_PATHS) {
    if (missing().length === 0) break;
    let target: string;
    try {
      target = new URL(path, base).toString();
    } catch {
      continue;
    }
    const html = await fetchDirect(target);
    if (html) groups.push(extractSocialHandles(html, brandName));
  }

  const still = missing();
  if (still.length > 0 && brandName) {
    groups.push(await searchForHandles(brandName, still));
  }

  return mergeHandles(...groups);
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

    // Handles a person entered. These are never overwritten by a refresh.
    const manual = new Set<string>();
    {
      const ids = competitors.map((c: any) => c.id);
      if (ids.length > 0) {
        const { data: rows } = await supabase
          .from("competitor_handles")
          .select("competitor_id, platform, source")
          .in("competitor_id", ids)
          .eq("source", "manual");
        for (const r of rows || []) manual.add(`${r.competitor_id}:${r.platform}`);
      }
    }

    // Serial on purpose: target sites are third parties, and a review set is
    // at most ~12 rows. Parallel fan-out buys seconds and risks rate limiting.
    for (const comp of competitors) {
      if (!comp.website_url) {
        results.push({ competitor_id: comp.id, detected: [] });
        continue;
      }
      const detected = await detectForSite(comp.website_url, comp.name);

      for (const h of detected) {
        if (refresh) {
          // A refresh replaces what the scraper found before, and leaves
          // alone what a person typed: correcting a wrong handle used to
          // last only until the next refresh overwrote it.
          if (manual.has(`${comp.id}:${h.platform}`)) continue;
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
              source: "auto",
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
              source: "auto",
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
