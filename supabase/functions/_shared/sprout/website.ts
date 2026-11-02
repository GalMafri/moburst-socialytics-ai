// supabase/functions/_shared/sprout/website.ts
//
// A brand's website, found in its own posts (spec: docs/superpowers/specs/
// 2026-11-02-sprout-auto-onboarding-design.md, section 4). Sprout's profile
// list has no website, so the search reads the links in the brand's posts
// of the last 90 days: domains most-linked first, each link followed through
// its redirects, social and app store links dropped. A domain is accepted
// only on an exact fact: its homepage links to one of the brand's profiles,
// its domain name is the brand name without spaces, or its og:site_name is
// the brand name. Up to three domains are tried. The weekly onboarding job
// and the lifecycle's website step run this same search.
//
// The network is behind SiteReader, so everything else here is pure and can
// be tested; webReader is the real one. It follows redirects itself, one hop
// at a time, so a link in somebody's post can never lead the server into a
// private address (net/safeUrl.ts).

import { BROWSER_UA } from "../brand/research.ts";
import { profileKeyOf, siteProfileLinks, type SproutProfile } from "../lifecycle/accounts.ts";
import { normName, sameName } from "../lifecycle/names.ts";
import { clientHost } from "../net/clientHost.ts";
import { isPubliclyFetchable } from "../net/safeUrl.ts";
import type { Brand } from "./brands.ts";

export type SiteFact = "profile_link" | "domain_name" | "site_name";

export interface SiteReader {
  /** Where a link lands after its redirects, or null when it cannot be followed. */
  resolve(url: string): Promise<string | null>;
  /** A homepage's HTML and the address it was served from after its redirects, or null when it does not answer. */
  homepage(url: string): Promise<{ html: string; url: string } | null>;
}

/** At most this many domains are tried as the website. */
export const MAX_SITES_TRIED = 3;
/** At most this many distinct links are followed through their redirects, the most frequent first. */
export const MAX_LINKS_FOLLOWED = 30;

const HOSTS = (list: string) => list.split(/\s+/).filter(Boolean);
/** Social networks: a link to one is never the brand's website. */
const SOCIAL = HOSTS("instagram.com facebook.com fb.com fb.me fb.watch m.me tiktok.com linkedin.com lnkd.in youtube.com youtu.be twitter.com x.com t.co threads.net threads.com pinterest.com pin.it");
/** App stores: a link to the brand's app, never its website. */
const APP_STORES = HOSTS("apps.apple.com itunes.apple.com play.google.com");
/** Link shorteners: followed, and dropped when they cannot be (lnkd.in and t.co wrap every link on LinkedIn and X). */
const SHORTENERS = HOSTS("bit.ly buff.ly ow.ly spr.ly tinyurl.com t.co lnkd.in goo.gl rebrand.ly is.gd trib.al dlvr.it ift.tt shorturl.at");

const under = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));
const hostOf = (url: string) => clientHost(url) ?? "";

/** Every link in a post's text: with a scheme, or a bare www. address. */
export function postLinks(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(/https?:\/\/[^\s"'<>()[\]{}]+|(?<![\w./@-])www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s"'<>()[\]{}]*/gi)) {
    const raw = m[0].replace(/[.,;:!?'"]+$/, "");
    out.push(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  }
  return out;
}

export interface LinkedDomain {
  domain: string;
  links: number;
}

/** The domains the posts link to, most-linked first (the first linked on a tie), after redirects, without social or app store links. */
export async function linkedDomains(posts: Array<{ text?: string | null }>, reader: SiteReader): Promise<LinkedDomain[]> {
  const occurrences = posts.flatMap((p) => postLinks(p.text))
    .filter((url) => { const h = hostOf(url); return !!h && !(under(h, SOCIAL) && !under(h, SHORTENERS)) && !under(h, APP_STORES); });
  const freq = new Map<string, number>();
  for (const url of occurrences) freq.set(url, (freq.get(url) ?? 0) + 1);
  const followed = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_LINKS_FOLLOWED).map(([url]) => url);
  const landed = new Map<string, string | null>();
  // A few at a time, so a slow site does not hold up the rest.
  for (let i = 0; i < followed.length; i += 5) {
    await Promise.all(followed.slice(i, i + 5).map(async (url) => landed.set(url, await reader.resolve(url).catch(() => null))));
  }
  const counts = new Map<string, number>();
  for (const url of occurrences) {
    if (!landed.has(url)) continue;
    const at = landed.get(url) ?? (under(hostOf(url), SHORTENERS) ? null : url);
    const host = at ? hostOf(at) : "";
    if (!host || under(host, SOCIAL) || under(host, APP_STORES) || under(host, SHORTENERS)) continue;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts.entries()].map(([domain, links]) => ({ domain, links })).sort((a, b) => b.links - a.links);
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", "#39": "'", lt: "<", gt: ">" };

/** A homepage's og:site_name, or null. */
export function siteNameOf(html: string | null | undefined): string | null {
  for (const m of String(html ?? "").matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/(?:property|name)\s*=\s*["']og:site_name["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
    const value = (content?.[1] ?? content?.[2] ?? "").replace(/&(amp|quot|apos|#39|lt|gt);/g, (_, e: string) => ENTITIES[e]).trim();
    if (value) return value;
  }
  return null;
}

/** The registered name in a host: "paythepyper" in www.paythepyper.com, "olo" in shop.olo.co.uk. */
export function domainLabel(host: string): string {
  const labels = String(host || "").toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length >= 3 && /^(co|com|org|net|ac|gov|edu|ltd|plc)$/.test(labels[labels.length - 2]) && labels[labels.length - 1].length === 2) return labels[labels.length - 3];
  return labels.length >= 2 ? labels[labels.length - 2] : labels[0] ?? "";
}

type BrandLike = Pick<Brand, "name" | "profiles">;
const namesOf = (brand: BrandLike) => [...new Set([brand.name, ...brand.profiles.map((p) => p.name)].map((n) => String(n || "").trim()).filter(Boolean))];

/** The exact fact that makes this domain the brand's website, or null. The domain-name fact needs no page. */
export function confirmingFact(brand: BrandLike, domain: string, html: string | null, finalHost?: string | null): SiteFact | null {
  if (html) {
    const linked = new Set(siteProfileLinks(html));
    if (brand.profiles.some((p: SproutProfile) => { const k = profileKeyOf(p); return !!k && linked.has(k); })) return "profile_link";
  }
  const compact = namesOf(brand).map((n) => normName(n).replace(/\s+/g, "")).filter(Boolean);
  const labels = [domainLabel(domain), finalHost ? domainLabel(finalHost) : ""].filter(Boolean);
  if (labels.some((l) => compact.includes(l))) return "domain_name";
  const site = html ? siteNameOf(html) : null;
  if (site && namesOf(brand).some((n) => sameName(site, n))) return "site_name";
  return null;
}

export interface WebsiteSearch {
  /** The confirmed website (the homepage's address after its redirects), or null. */
  website: string | null;
  confirmed_by: SiteFact | null;
  /** The domain the posts link to most, confirmed or not. */
  most_linked: string | null;
  domains: LinkedDomain[];
  tried: Array<{ domain: string; read: boolean; fact: SiteFact | null }>;
  /** The profile keys the confirmed homepage links to, for the website join. */
  site_profiles: string[];
}

/** The brand's website from its posts, or null with what was tried. */
export async function searchWebsite(brand: BrandLike, posts: Array<{ text?: string | null }>, reader: SiteReader): Promise<WebsiteSearch> {
  const domains = await linkedDomains(posts, reader);
  const tried: WebsiteSearch["tried"] = [];
  for (const { domain } of domains.slice(0, MAX_SITES_TRIED)) {
    const page = await reader.homepage(`https://${domain}`).catch(() => null);
    const fact = confirmingFact(brand, domain, page?.html ?? null, page ? hostOf(page.url) : null);
    tried.push({ domain, read: !!page, fact });
    if (!fact) continue;
    let website = `https://${domain}`;
    try {
      if (page) website = new URL(page.url).origin;
    } catch { /* the domain itself */ }
    return { website, confirmed_by: fact, most_linked: domains[0].domain, domains, tried, site_profiles: page ? siteProfileLinks(page.html) : [] };
  }
  return { website: null, confirmed_by: null, most_linked: domains[0]?.domain ?? null, domains, tried, site_profiles: [] };
}

/**
 * The pairs of brands their websites tie together (section 1): two brands
 * that confirm the same website, and a brand whose website links to another
 * brand's profiles.
 */
export function websiteJoins(found: Array<{ key: string; website: string | null; site_profiles: string[] }>, brands: Array<Pick<Brand, "key" | "profiles">>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  const add = (a: string, b: string) => {
    const id = [a, b].sort().join("|");
    if (a !== b && !seen.has(id)) { seen.add(id); pairs.push([a, b]); }
  };
  const withSite = found.filter((f) => clientHost(f.website));
  for (let i = 0; i < withSite.length; i++) {
    for (let j = i + 1; j < withSite.length; j++) {
      if (clientHost(withSite[i].website) === clientHost(withSite[j].website)) add(withSite[i].key, withSite[j].key);
    }
  }
  for (const f of withSite) {
    const linked = new Set(f.site_profiles);
    for (const b of brands) {
      if (b.profiles.some((p) => { const k = profileKeyOf(p); return !!k && linked.has(k); })) add(f.key, b.key);
    }
  }
  return pairs;
}

// ── The network ────────────────────────────────────────────────────────────

const HOPS = 5;

/** Fetch a URL, following up to five redirects by hand, refusing any hop to a private address. */
async function follow(fetchImpl: typeof fetch, url: string): Promise<{ response: Response; url: string } | null> {
  let at = url;
  for (let hop = 0; hop <= HOPS; hop++) {
    if (!isPubliclyFetchable(at)) return null;
    const response = await fetchImpl(at, { redirect: "manual", headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(10_000) });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      at = new URL(location, at).toString();
      continue;
    }
    return { response, url: at };
  }
  return null;
}

/** The real reader: direct requests with the browser user agent, ten seconds a hop. */
export function webReader(o: { fetchImpl?: typeof fetch } = {}): SiteReader {
  const f = o.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    async resolve(url) {
      try {
        const hit = await follow(f, url);
        if (!hit) return null;
        await hit.response.body?.cancel().catch(() => {});
        return hit.url;
      } catch {
        return null;
      }
    },
    async homepage(url) {
      try {
        const hit = await follow(f, url);
        if (!hit || !hit.response.ok) return null;
        return { html: await hit.response.text(), url: hit.url };
      } catch {
        return null;
      }
    },
  };
}
