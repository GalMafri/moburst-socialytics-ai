// supabase/functions/_shared/net/domains.ts
//
// Which domain a company registered, and which domains are shared platforms
// that are never one company's website.
//
// registrableDomain follows the Public Suffix List's algorithm (longest
// matching rule, wildcards, exceptions) over its ICANN section, generated
// into publicSuffixes.ts by scripts/build-public-suffixes.mjs from the copy
// the psl npm package ships (PUBLIC_SUFFIX_SOURCE says which). So app.olo.com
// is olo.com and shop.olo.co.uk is olo.co.uk, never a last-two-labels cut.
//
// SHARED_PLATFORMS is this code's one list of shared platforms: social
// networks, link shorteners, stores, podcast hosts, press-release sites, site
// builders and link-in-bio pages. A link to one is never a brand's website.
// The list's private section (myshopify.com and the like) is not used for
// this on purpose: what counts as shared is decided here, in one place, with
// a test. Free of Deno and network imports so it can be tested.

import { PUBLIC_SUFFIX_RULES } from "./publicSuffixes.ts";

const RULES = new Set(PUBLIC_SUFFIX_RULES.filter((r) => !r.startsWith("!")));
const EXCEPTIONS = new Set(PUBLIC_SUFFIX_RULES.filter((r) => r.startsWith("!")).map((r) => r.slice(1)));

/** A hostname from a URL or a bare host: lowercase, without a trailing dot. */
function hostOf(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** The domain a company registered under its public suffix ("olo.com" for app.olo.com), or null for a suffix, an IP address or nothing. */
export function registrableDomain(value: string | null | undefined): string | null {
  const host = hostOf(value);
  if (!host || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  // How many labels the public suffix has: the default rule "*" is one; the longest matching rule wins; an exception wins over all.
  let suffix = 1;
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join(".");
    if (EXCEPTIONS.has(candidate)) {
      suffix = labels.length - i - 1;
      break;
    }
    const wildcard = i + 1 < labels.length ? `*.${labels.slice(i + 1).join(".")}` : "";
    if (RULES.has(candidate) || (wildcard && RULES.has(wildcard))) suffix = Math.max(suffix, labels.length - i);
  }
  return labels.length > suffix ? labels.slice(labels.length - suffix - 1).join(".") : null;
}

export const PLATFORM_KINDS = ["social", "shortener", "store", "podcast", "press", "builder", "link_in_bio", "other"] as const;
export type PlatformKind = typeof PLATFORM_KINDS[number];

const list = (kind: PlatformKind, domains: string) => domains.split(/\s+/).filter(Boolean).map((d) => [d, kind] as const);

/**
 * Shared platforms, by registrable domain: any host under one is a page on
 * the platform, never a brand's own website. Link shorteners are followed
 * first, since they lead somewhere else; a shortened link that cannot be
 * followed is dropped.
 */
export const SHARED_PLATFORMS: Readonly<Record<string, PlatformKind>> = Object.fromEntries([
  ...list("social", `instagram.com facebook.com fb.com fb.watch messenger.com m.me tiktok.com linkedin.com youtube.com twitter.com x.com
    threads.net threads.com pinterest.com snapchat.com reddit.com whatsapp.com wa.me telegram.me t.me discord.com discord.gg tumblr.com quora.com`),
  ...list("shortener", `bit.ly buff.ly ow.ly spr.ly tinyurl.com t.co lnkd.in fb.me goo.gl youtu.be pin.it rebrand.ly is.gd trib.al dlvr.it ift.tt
    shorturl.at cutt.ly tiny.cc bl.ink qrco.de hubs.ly hubs.la amzn.to a.co lnk.to smarturl.it onelink.me app.link page.link adj.st sng.link`),
  ...list("store", `apple.com google.com amazon.com amazon.co.uk etsy.com ebay.com shopify.com myshopify.com walmart.com target.com
    ubereats.com doordash.com grubhub.com`),
  ...list("podcast", `anchor.fm spotify.com podbean.com buzzsprout.com libsyn.com soundcloud.com simplecast.com transistor.fm captivate.fm
    pod.link iheart.com podcasts.com spreaker.com`),
  ...list("press", `einpresswire.com prnewswire.com businesswire.com globenewswire.com prweb.com accesswire.com newswire.com openpr.com
    issuewire.com prlog.org`),
  ...list("builder", `wixsite.com wix.com squarespace.com weebly.com wordpress.com blogspot.com blogger.com github.io netlify.app vercel.app
    webflow.io carrd.co godaddysites.com notion.site substack.com medium.com ghost.io`),
  ...list("link_in_bio", "linktr.ee beacons.ai lnk.bio campsite.bio bio.link hoo.be tap.bio msha.ke linkin.bio"),
  ...list("other", `eventbrite.com meetup.com calendly.com zoom.us typeform.com forms.gle mailchi.mp list-manage.com canva.com gofundme.com
    patreon.com kickstarter.com indiegogo.com ticketmaster.com yelp.com tripadvisor.com wikipedia.org dropbox.com`),
]);

/** The kind of shared platform a URL or host is on, or null for a site of its own. */
export function sharedPlatformKind(value: string | null | undefined): PlatformKind | null {
  const domain = registrableDomain(value);
  return (domain && SHARED_PLATFORMS[domain]) || null;
}

export function isSharedPlatform(value: string | null | undefined): boolean {
  return sharedPlatformKind(value) !== null;
}

/** One key per site: its registrable domain, or its whole host (without www) when that is on a shared platform. */
export function siteKeyOf(value: string | null | undefined): string | null {
  const domain = registrableDomain(value);
  if (!domain) return null;
  return SHARED_PLATFORMS[domain] ? hostOf(value).replace(/^www\./, "") : domain;
}

/**
 * How a URL stands to a client's website: "host" when it is on the
 * website's own host (www aside), "site" when it is elsewhere on the same
 * site (siteKeyOf), null otherwise. A website on a subdomain of its own
 * (uproar.moburst.com) is that host only, so the rest of its registrable
 * domain is never its site; any other website keeps its subdomains
 * (careers.moburst.com is on www.moburst.com's site).
 */
export function siteMatch(url: string | null | undefined, website: string | null | undefined): "host" | "site" | null {
  const key = siteKeyOf(url);
  if (!key || siteKeyOf(website) !== key) return null;
  const own = hostOf(website).replace(/^www\./, "");
  if (hostOf(url).replace(/^www\./, "") === own) return "host";
  return own === registrableDomain(website) ? "site" : null;
}
