// Pull social profile links out of a brand website's HTML.
//
// Kept as a pure module (no Deno globals, no I/O) so vitest can cover it.
//
// This used to be six page-wide regexes, each matching one exact URL shape,
// first hit wins. Real sites broke every assumption in it: React sites emit
// `https:\/\/instagram.com\/acme` inside JSON, some templates emit `&#x2F;`
// entities, Facebook slugs carry hyphens, older channels live at
// /user/Name, mobile links come from m.facebook.com, and an influencer
// widget near the top of the page beat the brand's own footer. Meanwhile
// facebook.com/profile.php and instagram.com/tv/ matched and then owned the
// platform slot for good.
//
// So: normalise the document, harvest every URL-shaped token, classify by
// path shape against a reserved-path list, and score the candidates so the
// footer's link beats a widget's.

export interface DetectedHandle {
  platform: string;
  handle: string;
  profile_url: string;
}

/** Path segments that match the shape of a profile but never are one. */
const RESERVED: Record<string, Set<string>> = {
  instagram: new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "challenge", "about", "legal", "developer", "privacy", "terms"]),
  facebook: new Set(["sharer", "share", "sharer.php", "dialog", "plugins", "tr", "profile.php", "pages", "groups", "events", "watch", "story.php", "help", "policies", "legal", "privacy", "login", "search", "photo", "video", "media", "people", "hashtag"]),
  tiktok: new Set(["video", "tag", "music", "discover", "foryou", "explore", "legal", "about", "embed"]),
  linkedin: new Set(["shareArticle", "sharing", "feed", "posts", "pulse", "jobs", "legal", "help"]),
  youtube: new Set(["watch", "embed", "playlist", "results", "shorts", "feed", "about", "t", "howyoutubeworks"]),
  x: new Set(["intent", "share", "hashtag", "home", "explore", "i", "search", "login", "signup", "settings", "privacy", "tos", "notifications", "messages"]),
};

/** Hosts whose presence in a URL means the page is embedding, not linking. */
const EMBED_HINT = /\/(embed|plugins|sharer|intent|share|widget)/i;

interface Candidate {
  platform: string;
  handle: string;
  /** The sub-path YouTube needs to keep (@, channel/, c/, user/). */
  youtubeKind?: string;
  score: number;
  index: number;
}

/**
 * The document with the escapes real sites emit turned back into plain text:
 * JSON-escaped slashes, HTML entities, and the case folded for matching.
 */
export function normalizeDocument(html: string): string {
  return String(html || "")
    .replace(/\\\//g, "/")
    .replace(/&#x2f;|&#47;/gi, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** Every URL-shaped token in the document, with where it was found. */
function harvestUrls(text: string): Array<{ url: string; index: number }> {
  const out: Array<{ url: string; index: number }> = [];
  // http(s), protocol-relative, and bare host forms.
  const re = /(?:https?:)?\/\/[^\s"'<>\\)]+|(?:^|[\s"'(>])((?:www\.)?(?:instagram|facebook|tiktok|linkedin|youtube|twitter|x)\.com\/[^\s"'<>\\)]+)/gi;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] || m[0]).trim().replace(/[),.;]+$/, "");
    // The protocol is matched case-insensitively, so the check has to be too:
    // "HTTPS://..." used to be prefixed again and parsed as nothing.
    if (raw) {
      const url = raw.startsWith("//") ? `https:${raw}` : /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      out.push({ url, index: m.index ?? 0 });
    }
  }
  return out;
}

/** Which platform a host belongs to, ignoring www/m/web and language prefixes. */
function knownHost(h: string): string | null {
  if (h === "instagram.com") return "instagram";
  if (h === "facebook.com" || h === "fb.com") return "facebook";
  if (h === "tiktok.com") return "tiktok";
  if (h === "linkedin.com") return "linkedin";
  if (h === "youtube.com" || h === "youtu.be") return "youtube";
  if (h === "twitter.com" || h === "x.com") return "x";
  return null;
}

function platformOf(host: string): string | null {
  const raw = host.toLowerCase();
  // The whole host first. Stripping unconditionally ate the name out of
  // "fb.com", whose "fb" matches the two-letter language-prefix alternative,
  // leaving "com" and no facebook match at all.
  const direct = knownHost(raw);
  if (direct) return direct;
  const stripped = raw.replace(/^(?:www|m|web|[a-z]{2}-[a-z]{2}|[a-z]{2})\./, "");
  return stripped !== raw && stripped.includes(".") ? knownHost(stripped) : null;
}

const HANDLE_OK: Record<string, RegExp> = {
  instagram: /^[A-Za-z0-9._]{2,30}$/,
  facebook: /^[A-Za-z0-9._-]{3,60}$/,
  tiktok: /^[A-Za-z0-9._]{2,24}$/,
  linkedin: /^[A-Za-z0-9._-]{2,80}$/,
  youtube: /^[A-Za-z0-9._-]{2,60}$/,
  x: /^[A-Za-z0-9_]{2,15}$/,
};

/** A URL turned into a profile, or null when its path is not one. */
export function classifyUrl(url: string): { platform: string; handle: string; youtubeKind?: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const platform = platformOf(parsed.hostname);
  if (!platform) return null;
  if (EMBED_HINT.test(parsed.pathname)) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = decodeURIComponent(segments[0]);

  let handle = "";
  let youtubeKind: string | undefined;
  if (platform === "tiktok") {
    if (!first.startsWith("@")) return null;
    handle = first.slice(1);
  } else if (platform === "linkedin") {
    if (!["company", "showcase", "school"].includes(first)) return null;
    handle = segments[1] ? decodeURIComponent(segments[1]) : "";
  } else if (platform === "youtube") {
    if (first.startsWith("@")) {
      handle = first.slice(1);
      youtubeKind = "@";
    } else if (["channel", "c", "user"].includes(first)) {
      handle = segments[1] ? decodeURIComponent(segments[1]) : "";
      youtubeKind = `${first}/`;
    } else return null;
  } else {
    if (RESERVED[platform]?.has(first)) return null;
    handle = first;
  }
  if (!handle) return null;
  if (RESERVED[platform]?.has(handle)) return null;
  if (!HANDLE_OK[platform].test(handle)) return null;
  return { platform, handle, youtubeKind };
}

function canonicalProfileUrl(platform: string, handle: string, youtubeKind?: string): string {
  switch (platform) {
    case "instagram": return `https://www.instagram.com/${handle}/`;
    case "tiktok": return `https://www.tiktok.com/@${handle}`;
    case "facebook": return `https://www.facebook.com/${handle}`;
    case "linkedin": return `https://www.linkedin.com/company/${handle}/`;
    case "youtube": return `https://www.youtube.com/${youtubeKind === "@" || !youtubeKind ? "@" : youtubeKind}${handle}`;
    default: return `https://x.com/${handle}`;
  }
}

/** Word-ish tokens of a name, for matching a handle against the brand. */
function tokens(value: string): string[] {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * The brand's own profiles, best candidate per platform.
 *
 * `brandName` is optional context: a handle that shares a word with the
 * company name is far more likely to be theirs than one that does not,
 * which is what separates a brand's footer link from an embedded feed of
 * somebody else's posts.
 */
export function extractSocialHandles(html: string, brandName?: string): DetectedHandle[] {
  const text = normalizeDocument(html);
  const lower = text.toLowerCase();
  const brandTokens = tokens(brandName || "");
  // Where the social links usually live. Anything after the last of these
  // markers is treated as the page's own chrome.
  const footerAt = Math.max(lower.lastIndexOf("<footer"), lower.lastIndexOf('class="footer'), lower.lastIndexOf("id=\"footer"));
  const socialAt = lower.indexOf("social");

  const best = new Map<string, Candidate>();
  for (const { url, index } of harvestUrls(text)) {
    const hit = classifyUrl(url);
    if (!hit) continue;
    let score = 0;
    if (footerAt >= 0 && index >= footerAt) score += 3;
    if (index < 2000) score += 1; // header
    if (socialAt >= 0 && Math.abs(index - socialAt) < 1200) score += 2;
    const handleTokens = tokens(hit.handle);
    if (brandTokens.length && handleTokens.some((h) => brandTokens.some((b) => h.includes(b) || b.includes(h)))) score += 3;
    const current = best.get(hit.platform);
    if (!current || score > current.score) {
      best.set(hit.platform, { platform: hit.platform, handle: hit.handle, youtubeKind: hit.youtubeKind, score, index });
    }
  }

  return [...best.values()].map((c) => ({
    platform: c.platform,
    handle: c.handle,
    profile_url: canonicalProfileUrl(c.platform, c.handle, c.youtubeKind),
  }));
}

/** Merge results from several sources, keeping the first hit per platform. */
export function mergeHandles(...groups: DetectedHandle[][]): DetectedHandle[] {
  const out = new Map<string, DetectedHandle>();
  for (const group of groups) {
    for (const h of group) if (!out.has(h.platform)) out.set(h.platform, h);
  }
  return [...out.values()];
}
