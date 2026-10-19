// supabase/functions/_shared/competitive/detectHandles.ts
//
// Social profiles for competitors, from their own websites. Moved out of the
// detect-competitor-handles function on 19 Oct 2026 so the client
// lifecycle's competitors step looks up the profiles of the three it picks
// with the same rules.
//
// Nearly every brand site links its own profiles in the header or footer, so
// the homepage comes first (free). A page that answers without any links
// falls through to a rendered read (Firecrawl) and the contact and about
// pages, then to a profile search (Firecrawl) when the site links nothing.
// Handles land in competitor_handles, one row per competitor and platform.
// A handle a person typed is never overwritten, and one a person removed
// (source 'rejected') never comes back.

import { extractIndexedProfiles, extractSocialHandles, mergeHandles, type DetectedHandle } from "./extractSocialHandles.ts";
import { fetchWithRateLimitRetry } from "./fetchWithRateLimitRetry.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function env(k: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k);
}

function normalizeUrl(websiteUrl: string): string {
  const url = websiteUrl.trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

type SiteRead = { html: string; ok: boolean; warning?: string };

async function fetchDirect(url: string): Promise<SiteRead> {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return { html: "", ok: false, warning: `Website returned HTTP ${resp.status}.` };
    return { html: await resp.text(), ok: true };
  } catch (e) {
    return { html: "", ok: false, warning: (e as Error)?.name === "TimeoutError" ? "Company website timed out." : "Company website address could not be reached." };
  }
}

/**
 * The rendered page plus the links Firecrawl found on it. Firecrawl's
 * onlyMainContent would drop the footer, where a brand puts its social links.
 */
async function fetchRendered(url: string): Promise<SiteRead> {
  const firecrawlKey = env("FIRECRAWL_API_KEY");
  if (!firecrawlKey) return { html: "", ok: false, warning: "Rendered website lookup is not configured." };
  try {
    const fcResp = await fetchWithRateLimitRetry("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml", "links"], onlyMainContent: false, waitFor: 4000, timeout: 20000 }),
    }, 25000);
    if (!fcResp.ok) return { html: "", ok: false, warning: `Rendered website lookup returned HTTP ${fcResp.status}.` };
    const fcData = await fcResp.json();
    const siteStatus = Number(fcData.data?.metadata?.statusCode || 200);
    if (siteStatus >= 400) return { html: "", ok: false, warning: `Company website returned HTTP ${siteStatus}.` };
    const html = fcData.data?.rawHtml || fcData.data?.html || fcData.rawHtml || fcData.html || "";
    const links: string[] = fcData.data?.links || fcData.links || [];
    return { html: `${html}\n${links.join("\n")}`, ok: fcData.success !== false, ...(fcData.success === false ? { warning: "Rendered website lookup did not complete." } : {}) };
  } catch {
    return { html: "", ok: false, warning: "Rendered website lookup timed out or could not complete." };
  }
}

/** Pages that carry the social links when the homepage does not. */
const FALLBACK_PATHS = ["/contact", "/about", "/about-us", "/company"];
const ALL_PLATFORMS = ["instagram", "facebook", "tiktok", "linkedin", "youtube", "x"];

async function searchProfiles(name: string): Promise<{ handles: DetectedHandle[]; ok: boolean }> {
  const key = env("FIRECRAWL_API_KEY");
  if (!key) return { handles: [], ok: false };
  try {
    const response = await fetchWithRateLimitRetry("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `"${name.replace(/["\r\n]/g, " ")}" (site:instagram.com OR site:facebook.com OR site:linkedin.com OR site:youtube.com OR site:tiktok.com OR site:x.com)`, limit: 10 }),
    }, 20000);
    if (!response.ok) return { handles: [], ok: false };
    const data = await response.json();
    return { handles: extractIndexedProfiles(Array.isArray(data.data) ? data.data : data.data?.web || [], name), ok: data.success !== false };
  } catch {
    return { handles: [], ok: false };
  }
}

export async function detectForSite(websiteUrl: string, brandName?: string) {
  const base = normalizeUrl(websiteUrl);
  const direct = await fetchDirect(base);
  const groups = [extractSocialHandles(direct.html, brandName)];
  const reads: SiteRead[] = [direct];
  if (ALL_PLATFORMS.some((p) => !groups[0].some((h) => h.platform === p))) {
    const more = await Promise.all([fetchRendered(base), ...FALLBACK_PATHS.map((path) => fetchDirect(new URL(path, base).toString()))]);
    reads.push(...more);
    groups.push(...more.map((r) => extractSocialHandles(r.html, brandName)));
  }
  const websiteHandles = mergeHandles(...groups);
  const indexed = websiteHandles.length || !brandName ? { handles: [], ok: false } : await searchProfiles(brandName);
  return {
    handles: mergeHandles(websiteHandles, indexed.handles),
    searchedIndex: indexed.ok,
    readSucceeded: reads.some((r) => r.ok),
    // Missing optional contact or about pages do not make a homepage lookup a failure.
    warnings: [direct, reads[1]].filter((r): r is SiteRead => !!r && !r.ok).map((r) => r.warning!).filter(Boolean),
  };
}

// deno-lint-ignore no-explicit-any
type Db = any;

export interface DetectTarget {
  id: string;
  client_id: string;
  name: string;
  website_url: string | null;
}

export interface DetectResult {
  competitor_id: string;
  detected: DetectedHandle[];
  status: string;
  warnings?: string[];
}

const NO_WEBSITE = "No company website is on file.";

/**
 * Look up and save the profiles of these competitors, one after another
 * (target sites are third parties). `refresh` replaces earlier automatic
 * finds; without it only missing platforms are filled.
 */
export async function detectCompetitorHandles(db: Db, competitors: DetectTarget[], opts: { refresh?: boolean } = {}): Promise<{ results: DetectResult[]; writeErrors: string[] }> {
  const manual = new Set<string>();
  const rejected = new Set<string>();
  const writeErrors: string[] = [];
  const ids = competitors.map((c) => c.id);
  if (ids.length > 0) {
    const { data: rows, error } = await db.from("competitor_handles").select("competitor_id, platform, source").in("competitor_id", ids).in("source", ["manual", "rivaliq", "rejected"]);
    if (error) throw new Error("Could not verify existing handle decisions. No handles were changed.");
    for (const r of rows || []) {
      const k = `${r.competitor_id}:${r.platform}`;
      if (r.source === "rejected") rejected.add(k);
      else manual.add(k);
    }
  }
  const results: DetectResult[] = [];
  for (const comp of competitors) {
    const saveStatus = async (status: string, warnings: string[] = []) => {
      const { error } = await db.from("competitors").update({
        profile_detection: { status, discovery_version: 2, detail: warnings.join(" "), checked_at: new Date().toISOString() },
      }).eq("id", comp.id);
      if (error) throw new Error("Could not save profile lookup progress.");
    };
    if (!comp.website_url) {
      await saveStatus("missing_website", [NO_WEBSITE]);
      results.push({ competitor_id: comp.id, detected: [], status: "missing_website", warnings: [NO_WEBSITE] });
      continue;
    }
    await saveStatus("running");
    const previousWriteErrors = writeErrors.length;
    const discovery = await detectForSite(comp.website_url, comp.name);
    const saved: string[] = [];
    for (const h of discovery.handles) {
      const k = `${comp.id}:${h.platform}`;
      // A handle a person deleted stays deleted; one a person typed (or RivalIQ tracks) is kept.
      if (rejected.has(k)) continue;
      if (opts.refresh && manual.has(k)) { saved.push(h.platform); continue; }
      const row = {
        competitor_id: comp.id, client_id: comp.client_id, platform: h.platform, handle: h.handle, profile_url: h.profile_url,
        is_active: true, detection_confidence: h.confidence, source: "auto",
        ...(opts.refresh ? { detected_at: new Date().toISOString() } : {}),
      };
      const { error: upErr } = await db.from("competitor_handles").upsert(row, { onConflict: "competitor_id,platform", ...(opts.refresh ? {} : { ignoreDuplicates: true }) });
      if (upErr) { writeErrors.push(`${comp.name} ${h.platform}: ${upErr.message}`); continue; }
      saved.push(h.platform);
    }
    const retained = discovery.handles.filter((h) => saved.includes(h.platform));
    const failedWrite = writeErrors.length > previousWriteErrors;
    const status = failedWrite ? "failed" : retained.length ? "found" : !discovery.readSucceeded ? (discovery.searchedIndex ? "unverified" : "failed") : discovery.warnings.length ? "partial" : "not_found";
    const warnings = failedWrite ? ["Profiles could not be saved; the lookup runs again later."]
      : retained.length ? []
      : status === "unverified" ? ["The company website is unavailable and no official social profile was verified."]
      : discovery.warnings;
    await saveStatus(status, warnings);
    results.push({ competitor_id: comp.id, detected: retained, status, warnings });
  }
  return { results, writeErrors };
}
