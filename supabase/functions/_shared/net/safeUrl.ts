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
