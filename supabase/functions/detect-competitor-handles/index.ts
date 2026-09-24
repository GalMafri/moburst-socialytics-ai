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
import { extractSocialHandles, extractIndexedProfiles, mergeHandles, type DetectedHandle } from "../_shared/competitive/extractSocialHandles.ts";

import { fetchWithRateLimitRetry } from "../_shared/competitive/fetchWithRateLimitRetry.ts";

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

type SiteRead = { html: string; ok: boolean; warning?: string };

async function fetchDirect(url: string): Promise<SiteRead> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
      redirect: "follow",
      // A site that never answers used to hold the whole set behind it.
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      console.log(`[detect] ${resp.status} ${url}`);
      return { html: "", ok: false, warning: `Website returned HTTP ${resp.status}.` };
    }
    return { html: await resp.text(), ok: true };
  } catch (e) {
    console.log(`[detect] fetch failed ${url}: ${(e as Error)?.name || e}`);
    return { html: "", ok: false, warning: (e as Error)?.name === "TimeoutError" ? "Company website timed out." : "Company website address could not be reached." };
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
async function fetchRendered(url: string): Promise<SiteRead> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) {
    console.log("[detect] no FIRECRAWL_API_KEY; skipping the rendered pass");
    return { html: "", ok: false, warning: "Rendered website lookup is not configured." };
  }
  try {
    const fcResp = await fetchWithRateLimitRetry("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",

      headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml", "links"], onlyMainContent: false, waitFor: 4000, timeout: 20000 }),
    }, 25000);
    if (!fcResp.ok) {
      console.log(`[detect] firecrawl ${fcResp.status} for ${url}: ${(await fcResp.text().catch(() => "")).slice(0, 200)}`);
      return { html: "", ok: false, warning: `Rendered website lookup returned HTTP ${fcResp.status}.` };
    }
    const fcData = await fcResp.json();
    const siteStatus = Number(fcData.data?.metadata?.statusCode || 200);
    if (siteStatus >= 400) return { html: "", ok: false, warning: `Company website returned HTTP ${siteStatus}.` };
    const html = fcData.data?.rawHtml || fcData.data?.html || fcData.rawHtml || fcData.html || "";
    const links: string[] = fcData.data?.links || fcData.links || [];
    // The links go in as plain text; the extractor treats them as URLs.
    return { html: `${html}\n${links.join("\n")}`, ok: fcData.success !== false,
      ...(fcData.success === false ? { warning: "Rendered website lookup did not complete." } : {}) };
  } catch (e) {
    console.log(`[detect] firecrawl threw for ${url}: ${(e as Error)?.message || e}`);
    return { html: "", ok: false, warning: "Rendered website lookup timed out or could not complete." };
  }
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

async function searchProfiles(name: string): Promise<{ handles: DetectedHandle[]; ok: boolean }> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return { handles: [], ok: false };
  try {
    const response = await fetchWithRateLimitRetry("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `"${name.replace(/["\r\n]/g, ' ')}" (site:instagram.com OR site:facebook.com OR site:linkedin.com OR site:youtube.com OR site:tiktok.com OR site:x.com)`, limit: 10 }),
    }, 20000);
    if (!response.ok) return { handles: [], ok: false };
    const data = await response.json();
    return { handles: extractIndexedProfiles(Array.isArray(data.data) ? data.data : data.data?.web || [], name), ok: data.success !== false };
  } catch { return { handles: [], ok: false }; }
}

async function detectForSite(websiteUrl: string, brandName?: string) {
  const base = normalizeUrl(websiteUrl);
  const direct = await fetchDirect(base);
  const groups = [extractSocialHandles(direct.html, brandName)];
  const reads: SiteRead[] = [direct];
  if (ALL_PLATFORMS.some(p => !groups[0].some(h => h.platform === p))) {
    // These independent reads used to run serially, then the UI repeated
    // the entire sweep even when it was a completed, empty search.
    const more = await Promise.all([
      fetchRendered(base),
      ...FALLBACK_PATHS.map(path => fetchDirect(new URL(path, base).toString())),
    ]);
    reads.push(...more);
    groups.push(...more.map(r => extractSocialHandles(r.html, brandName)));
  }
  const websiteHandles = mergeHandles(...groups);
  const indexed = websiteHandles.length || !brandName ? { handles: [], ok: false } : await searchProfiles(brandName);
  return {
    handles: mergeHandles(websiteHandles, indexed.handles),
    searchedIndex: indexed.ok,
    readSucceeded: reads.some(r => r.ok),
    // Missing optional contact/about pages do not make a valid homepage
    // lookup a failure. Report failures of the two primary discovery paths.
    warnings: [direct, reads[1]].filter((r): r is SiteRead => !!r && !r.ok)
      .map(r => r.warning!).filter(Boolean),
  };
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

    const results: Array<{ competitor_id: string; detected: DetectedHandle[]; status: string; warnings?: string[] }> = [];

    // Handles a person entered. These are never overwritten by a refresh.
    const manual = new Set<string>();
    /**
     * Platforms a person removed, and the ones RivalIQ supplied.
     *
     * Both are decisions the scraper must not undo. A removed handle used to
     * come back on the next refresh, because removal deleted the row and so
     * left no trace of the decision; it is now kept as source 'rejected'.
     * RivalIQ's tracked profiles were being overwritten by website guesses
     * for the same reason: the import never marked where they came from.
     */
    const rejected = new Set<string>();
    const writeErrors: string[] = [];
    {
      const ids = competitors.map((c: any) => c.id);
      if (ids.length > 0) {
        const { data: rows, error: protectedRowsError } = await supabase
          .from("competitor_handles")
          .select("competitor_id, platform, source")
          .in("competitor_id", ids)
          .in("source", ["manual", "rivaliq", "rejected"]);
        if (protectedRowsError) throw new Error("Could not verify existing handle decisions. No handles were changed.");
        for (const r of rows || []) {
          const k = `${r.competitor_id}:${r.platform}`;
          if (r.source === "rejected") rejected.add(k);
          else manual.add(k);
        }
      }
    }

    // Serial on purpose: target sites are third parties, and a review set is
    // at most ~12 rows. Parallel fan-out buys seconds and risks rate limiting.
    for (const comp of competitors) {
      const saveStatus = async (status: string, warnings: string[] = []) => {
        const { error } = await supabase.from("competitors").update({
          profile_detection: { status, discovery_version: 2, detail: warnings.join(" "), checked_at: new Date().toISOString() },
        }).eq("id", comp.id);
        if (error) throw new Error("Could not save profile lookup progress. Please reopen the draft to resume.");
      };
      if (!comp.website_url) {
        await saveStatus("missing_website", ["Add a company website to find its profiles automatically."]);
        results.push({ competitor_id: comp.id, detected: [], status: "missing_website", warnings: ["Add a company website to find its profiles automatically."] });
        continue;
      }
      await saveStatus("running");
      const previousWriteErrors = writeErrors.length;
      const discovery = await detectForSite(comp.website_url, comp.name);
      const detected = discovery.handles;
      const saved: string[] = [];

      for (const h of detected) {
        if (refresh) {
          // A refresh replaces what the scraper found before, and leaves
          // alone what a person typed: correcting a wrong handle used to
          // last only until the next refresh overwrote it.
          //
          // The handle still counts as covered in the reported result: the
          // caller uses an empty list to mean "this competitor has no handle
          // at all" and would otherwise re-scrape the site and tell the user
          // to go find a handle that is already saved.
          if (manual.has(`${comp.id}:${h.platform}`)) { saved.push(h.platform); continue; }
          // A handle a person deleted stays deleted: re-adding it on the next
          // refresh is how a wrong guess kept coming back.
          if (rejected.has(`${comp.id}:${h.platform}`)) continue;
          const { error: upErr } = await supabase.from("competitor_handles").upsert(
            {
              competitor_id: comp.id,
              client_id: comp.client_id,
              platform: h.platform,
              handle: h.handle,
              profile_url: h.profile_url,
              is_active: true,
              // What the page actually evidenced, not a flat number. A link
              // loose in the body naming nothing like the brand is a guess
              // and is now recorded as one.
              detection_confidence: h.confidence,
              detected_at: new Date().toISOString(),
              source: "auto",
            },
            { onConflict: "competitor_id,platform" },
          );
          if (upErr) { writeErrors.push(`${comp.name} ${h.platform}: ${upErr.message}`); continue; }
          saved.push(h.platform);
        } else {
          if (rejected.has(`${comp.id}:${h.platform}`)) continue;
          // Fill gaps only — never clobber a row a human may have edited.
          const { error: upErr } = await supabase.from("competitor_handles").upsert(
            {
              competitor_id: comp.id,
              client_id: comp.client_id,
              platform: h.platform,
              handle: h.handle,
              profile_url: h.profile_url,
              is_active: true,
              detection_confidence: h.confidence,
              source: "auto",
            },
            { onConflict: "competitor_id,platform", ignoreDuplicates: true },
          );
          if (upErr) { writeErrors.push(`${comp.name} ${h.platform}: ${upErr.message}`); continue; }
          saved.push(h.platform);
        }
      }
      // Report what was written, not what was found: the two used to differ
      // silently whenever an upsert failed.
      const retained = detected.filter(h => saved.includes(h.platform));
      const status = writeErrors.length > previousWriteErrors ? "failed" : retained.length ? "found" : !discovery.readSucceeded ? (discovery.searchedIndex ? "unverified" : "failed") : discovery.warnings.length ? "partial" : "not_found";
      const warnings = writeErrors.length > previousWriteErrors ? ["Profiles could not be saved. Automatic lookup will retry later."] : retained.length ? [] : status === "unverified" ? ["The company website is unavailable and no matching official social profile was verified. This suggestion needs a corrected website or a verified profile before selection."] : discovery.warnings;
      await saveStatus(status, warnings);
      results.push({ competitor_id: comp.id, detected: retained, status, warnings });
    }

    return jsonResp(writeErrors.length ? { results, write_errors: writeErrors } : { results });
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
