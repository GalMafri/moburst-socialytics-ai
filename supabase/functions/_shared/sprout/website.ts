// supabase/functions/_shared/sprout/website.ts
//
// A brand's website, found in its own posts (spec: docs/superpowers/specs/
// 2026-11-02-sprout-auto-onboarding-design.md, section 4). Sprout's profile
// list has no website, so the search reads the links in the brand's posts
// of the last 90 days: each link followed through its redirects, and
// counted under the registrable domain it lands on (app.olo.com is olo.com,
// net/domains.ts), most-linked first, and links to a shared platform (a
// social network, store, podcast host, press-release site, site builder:
// net/domains.ts SHARED_PLATFORMS) never counted. A domain is accepted only
// on an exact fact: its homepage links to one of the brand's profiles, its
// registered name is one of the brand's names (nameLabels), or its
// og:site_name is the brand name. Up to three domains are tried, each at its
// registrable domain's homepage. The weekly onboarding job and the
// lifecycle's website step run this same search.
//
// When the posts confirm none, the lifecycle's website step searches the web
// for the brand by name (spec: docs/superpowers/specs/2026-11-03-onboarding-
// complete-design.md, section 4): up to three searches (the name and each
// distinct handle), shared platforms and the domains the post search tried
// dropped, three new domains read at most. A searched domain counts only
// when its homepage links to one of the brand's own profiles: a short name
// finds other companies, so a name match alone never does.
//
// The network is behind SiteReader, so everything else here is pure and can
// be tested; webReader is the real one. It follows redirects itself, one hop
// at a time, so a link in somebody's post can never lead the server into a
// private address (net/safeUrl.ts).

import { BROWSER_UA } from "../brand/research.ts";
import { profileKeyOf, siteProfileLinks, type SproutProfile } from "../lifecycle/accounts.ts";
import { sameName } from "../lifecycle/names.ts";
import { registrableDomain, sharedPlatformKind, siteKeyOf } from "../net/domains.ts";
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

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };

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

/**
 * The registrable domains the posts link to, most-linked first (the first
 * linked on a tie), where each link lands after its redirects. A link to a
 * shared platform is dropped unread, except a link shortener (lnkd.in and
 * t.co wrap every link on LinkedIn and X), which is followed and dropped
 * when it cannot be; a link that lands on a shared platform is dropped too.
 */
export async function linkedDomains(posts: Array<{ text?: string | null }>, reader: SiteReader): Promise<LinkedDomain[]> {
  const occurrences = posts.flatMap((p) => postLinks(p.text)).filter((url) => {
    const kind = sharedPlatformKind(url);
    return !!registrableDomain(url) && (kind === null || kind === "shortener");
  });
  const freq = new Map<string, number>();
  for (const url of occurrences) freq.set(url, (freq.get(url) ?? 0) + 1);
  const followed = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_LINKS_FOLLOWED).map(([url]) => url);
  const landed = new Map<string, string | null>();
  // Ten at a time, so a slow site does not hold up the rest.
  for (let i = 0; i < followed.length; i += 10) {
    await Promise.all(followed.slice(i, i + 10).map(async (url) => landed.set(url, await reader.resolve(url).catch(() => null))));
  }
  const counts = new Map<string, number>();
  for (const url of occurrences) {
    const shortened = sharedPlatformKind(url) === "shortener";
    const at = landed.get(url) ?? (shortened ? null : url);
    const domain = at && !sharedPlatformKind(at) ? registrableDomain(at) : null;
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
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

/** The registered name in a host, by its registrable domain: "paythepyper" in www.paythepyper.com, "olo" in app.olo.com and shop.olo.co.uk. */
export function domainLabel(host: string): string {
  return (registrableDomain(host) ?? "").split(".")[0] ?? "";
}

/** Words a name may carry around the brand's own name ("Olo App", "DermaAngel US", "The Official Twos"). */
export const NAME_EXTRA_WORDS = new Set(["the", "official", "app", "us", "usa", "hq", "inc", "llc", "co", "global"]);

/**
 * Every way the brand's names can be a domain's registered name: each name
 * lowercased with spaces and punctuation removed ("&" read either as nothing
 * or as "and"), and the same for the name before a tagline ("Olo App" in
 * "Olo App | Food Ordering", "Olo" in "Olo - Skip the Line"); then each with
 * its leading or trailing words from NAME_EXTRA_WORDS dropped, as long as a
 * word of the name is left.
 */
export function nameLabels(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    const text = String(name || "").toLowerCase();
    const head = text.split(/\s+[-\u2013\u2014]\s+|\s*\|\s*|\s*\(|:\s+/)[0];
    for (const part of new Set([text, head])) {
      for (const amp of [part.replace(/&/g, " "), part.replace(/&/g, " and ")]) {
        const words = amp.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        let first = 0;
        let last = words.length;
        const starts = [0];
        while (first < last - 1 && NAME_EXTRA_WORDS.has(words[first])) starts.push(++first);
        const ends = [words.length];
        while (last > 1 && NAME_EXTRA_WORDS.has(words[last - 1])) ends.push(--last);
        for (const a of starts) for (const b of ends) if (b - a >= 1) out.add(words.slice(a, b).join(""));
      }
    }
  }
  out.delete("");
  return out;
}

type BrandLike = Pick<Brand, "name" | "profiles"> & { group?: Brand["group"] };
/** Every name of the brand: its own, its Sprout group's and each profile's. */
const namesOf = (brand: BrandLike) => [...new Set([brand.name, brand.group?.name, ...brand.profiles.map((p) => p.name)].map((n) => String(n || "").trim()).filter(Boolean))];

/** The exact fact that makes this domain the brand's website, or null. The domain-name fact needs no page. */
export function confirmingFact(brand: BrandLike, domain: string, html: string | null, finalHost?: string | null): SiteFact | null {
  if (html) {
    const linked = new Set(siteProfileLinks(html));
    if (brand.profiles.some((p: SproutProfile) => { const k = profileKeyOf(p); return !!k && linked.has(k); })) return "profile_link";
  }
  const names = nameLabels(namesOf(brand));
  const labels = [domainLabel(domain), finalHost ? domainLabel(finalHost) : ""].filter(Boolean);
  if (labels.some((l) => names.has(l))) return "domain_name";
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
    // The homepage's address after its redirects, unless they led onto a shared platform (a store, a link page): then the domain itself.
    let website = `https://${domain}`;
    try {
      if (page && !sharedPlatformKind(page.url)) website = new URL(page.url).origin;
    } catch { /* the domain itself */ }
    return { website, confirmed_by: fact, most_linked: domains[0].domain, domains, tried, site_profiles: page ? siteProfileLinks(page.html) : [] };
  }
  return { website: null, confirmed_by: null, most_linked: domains[0]?.domain ?? null, domains, tried, site_profiles: [] };
}

/** At most this many web searches for a brand's website, and this many new domains read from them. */
export const MAX_NAME_SEARCHES = 3;
export const MAX_SEARCHED_SITES = 3;

/** A web search: the addresses of its results, in their order. */
export interface SearchEngine {
  search(query: string): Promise<string[]>;
}

/** What a brand's website is searched by: its name, then each distinct handle, at most three. */
export function nameQueries(name: string, handles: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of [name, ...handles].map((x) => String(x || "").trim()).filter(Boolean)) {
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out.slice(0, MAX_NAME_SEARCHES);
}

export interface NameSearch {
  website: string | null;
  confirmed_by: "profile_link" | null;
  queries: string[];
  tried: Array<{ domain: string; read: boolean; linked: boolean }>;
  /** The profile keys the confirmed homepage links to. */
  site_profiles: string[];
}

/** The brand's website searched by name: the first new domain whose homepage links to one of the brand's profiles. */
export async function searchWebsiteByName(brand: BrandLike, engine: SearchEngine, reader: SiteReader, o: { skip?: string[] } = {}): Promise<NameSearch> {
  const skip = new Set((o.skip ?? []).map((d) => d.toLowerCase()));
  const queries = nameQueries(brand.name, brand.profiles.map((p) => p.native_name));
  const tried: NameSearch["tried"] = [];
  const asked: string[] = [];
  const keys = new Set(brand.profiles.map((p: SproutProfile) => profileKeyOf(p)).filter(Boolean) as string[]);
  for (const q of queries) {
    asked.push(q);
    const urls = await engine.search(q).catch(() => [] as string[]);
    for (const url of urls) {
      if (tried.length >= MAX_SEARCHED_SITES) break;
      const domain = registrableDomain(url);
      if (!domain || sharedPlatformKind(url) || skip.has(domain) || tried.some((t) => t.domain === domain)) continue;
      const page = await reader.homepage(`https://${domain}`).catch(() => null);
      const linked = !!page && siteProfileLinks(page.html).some((k) => keys.has(k));
      tried.push({ domain, read: !!page, linked });
      if (!linked) continue;
      let website = `https://${domain}`;
      try {
        if (page && !sharedPlatformKind(page.url)) website = new URL(page.url).origin;
      } catch { /* the domain itself */ }
      return { website, confirmed_by: "profile_link", queries: asked, tried, site_profiles: siteProfileLinks(page!.html) };
    }
    if (tried.length >= MAX_SEARCHED_SITES) break;
  }
  return { website: null, confirmed_by: null, queries: asked, tried, site_profiles: [] };
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
  const withSite = found.filter((f) => siteKeyOf(f.website));
  for (let i = 0; i < withSite.length; i++) {
    for (let j = i + 1; j < withSite.length; j++) {
      if (siteKeyOf(withSite[i].website) === siteKeyOf(withSite[j].website)) add(withSite[i].key, withSite[j].key);
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
/** One link or homepage, every redirect and the page itself, gets this long in all. */
const READ_MS = 10_000;

/** Fetch a URL, following up to five redirects by hand, refusing any hop to a private address. */
async function follow(fetchImpl: typeof fetch, url: string): Promise<{ response: Response; url: string } | null> {
  let at = url;
  const signal = AbortSignal.timeout(READ_MS);
  for (let hop = 0; hop <= HOPS; hop++) {
    if (!isPubliclyFetchable(at)) return null;
    const response = await fetchImpl(at, { redirect: "manual", headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" }, signal });
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

/** The real reader: direct requests with the browser user agent, ten seconds for each link or homepage in all. */
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
