// Refusing to fetch a URL that points back inside our own network.
//
// post-preview takes URLs from the request body and fetches them server-side,
// from inside Supabase's network, then copies what comes back into a PUBLIC
// bucket. Any signed-in user could therefore aim it at a private address and
// read what came back. Cloud metadata endpoints (169.254.169.254) are the
// classic target, and loopback reaches anything the function itself can.
//
// A post permalink is always a public host on the open internet, so nothing
// legitimate is lost by refusing the rest.

/** Hosts that never belong in a social post permalink. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some((n) => n > 255)) return true; // malformed: refuse
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(h)) return true; // unique local fc00::/7

  // IPv4-mapped. The URL parser rewrites ::ffff:127.0.0.1 into hextets as
  // ::ffff:7f00:1, so the dotted form never survives to be matched: the two
  // trailing groups have to be unpacked back into octets.
  const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  if (h.startsWith("::ffff:")) return isPrivateIPv4(h.slice(7)); // dotted form, if it ever survives
  return false;
}

/**
 * True when this is an ordinary public http(s) URL we are willing to fetch.
 *
 * Anything unparseable, any scheme other than http/https, and any host that
 * resolves by literal to a private, loopback or link-local address is refused.
 */
export function isPubliclyFetchable(raw: string | null | undefined): boolean {
  let u: URL;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (isPrivateIPv4(host)) return false;
  if (isPrivateIPv6(host)) return false;
  return true;
}

/** True when the host is the domain itself or one of its subdomains, compared on the parsed host and never as a substring. */
function hostIsOrUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function parsedHost(raw: string | null | undefined): string | null {
  try {
    const u = new URL(String(raw ?? ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const SOCIAL_HOSTS: Array<[string, string[]]> = [
  ["youtube", ["youtube.com", "youtu.be"]],
  ["tiktok", ["tiktok.com"]],
  ["instagram", ["instagram.com"]],
  ["facebook", ["facebook.com", "fb.com", "fb.watch"]],
  ["linkedin", ["linkedin.com"]],
  ["x", ["x.com", "twitter.com"]],
];

/**
 * The social network a post permalink belongs to, decided on the parsed host
 * (the exact domain or a subdomain of it). A path or query that merely
 * mentions a network, or a host such as netflix.com that ends in "x.com",
 * is not a post of that network.
 */
export function socialPlatformOf(url: string | null | undefined): string | null {
  if (!isPubliclyFetchable(url)) return null;
  const host = parsedHost(url);
  if (!host) return null;
  for (const [platform, domains] of SOCIAL_HOSTS) {
    if (domains.some((d) => hostIsOrUnder(host, d))) return platform;
  }
  return null;
}

const CDN_DOMAINS = ["cdninstagram.com", "fbcdn.net", "fbsbx.com", "licdn.com", "network-media.sproutsocial.com"];

/**
 * True for the media hosts whose links are signed and stop working after
 * hours or days (the social networks' CDNs, and Sprout's media host, which
 * redirects to them). Decided on the parsed host; a file name that happens to
 * contain "scontent" on any other host does not count.
 */
export function isExpiringCdnUrl(url: string | null | undefined): boolean {
  if (!isPubliclyFetchable(url)) return false;
  const host = parsedHost(url);
  if (!host) return false;
  if (CDN_DOMAINS.some((d) => hostIsOrUnder(host, d))) return true;
  return /(^|\.)tiktokcdn(-[a-z]+)?\.com$/.test(host);
}

/** Answers a hostname with the addresses it points at. */
export type HostResolver = (host: string) => Promise<string[]>;

/** The runtime's own DNS lookup (A and AAAA). A runtime without one answers nothing, and the fetch itself then decides. */
const runtimeResolver: HostResolver = async (host) => {
  const d = (globalThis as { Deno?: { resolveDns?: (name: string, type: "A" | "AAAA") => Promise<string[]> } }).Deno;
  if (typeof d?.resolveDns !== "function") return [];
  const answers = await Promise.all((["A", "AAAA"] as const).map((type) => d.resolveDns!(host, type).catch(() => [] as string[])));
  return answers.flat();
};

/** True when any address the host points at is private, loopback or link-local. A literal address was already judged by isPubliclyFetchable. */
async function resolvesToPrivate(raw: string, resolve: HostResolver): Promise<boolean> {
  const host = new URL(raw).hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  const addresses = await resolve(host);
  return addresses.some((a) => isPrivateIPv4(a) || isPrivateIPv6(a));
}

/**
 * fetch that follows redirects itself, so every hop is checked the way the
 * first address was. A public host that redirects to a private address is
 * refused before any request goes to the private address. Each hop's name is
 * also resolved, so a public-looking name that points at a private address
 * (a wildcard DNS name, or a record someone controls) is refused too.
 *
 * Open residual: the name is resolved here and again by the fetch itself, so a
 * record that changes between the two lookups (DNS rebinding) is not caught.
 * Where the runtime has no Deno.resolveDns, only literal addresses are checked.
 */
export async function fetchPublic(
  raw: string,
  init: RequestInit = {},
  send: typeof fetch = fetch,
  maxHops = 5,
  resolve: HostResolver = runtimeResolver,
): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!isPubliclyFetchable(current) || (await resolvesToPrivate(current, resolve))) throw new Error("That address cannot be fetched.");
    const response = await send(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) return response;
    current = new URL(location, current).href;
  }
  throw new Error("Too many redirects.");
}
