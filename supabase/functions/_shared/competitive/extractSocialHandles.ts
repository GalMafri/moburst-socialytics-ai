// Pull social profile links out of a brand website's HTML.
//
// Kept as a pure module (no Deno globals, no I/O) so vitest can cover the
// regex surface — profile-shaped URLs that are actually share buttons, embed
// scripts, or platform help pages are the classic false positives here.

export interface DetectedHandle {
  platform: string;
  handle: string;
  profile_url: string;
}

const PATTERNS: Array<{ platform: string; re: RegExp }> = [
  // instagram.com/{handle}
  { platform: "instagram", re: /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})(?:[/?"'#\\]|$)/g },
  // tiktok.com/@{handle}
  { platform: "tiktok", re: /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,24})(?:[/?"'#\\]|$)/g },
  // facebook.com/{page}
  { platform: "facebook", re: /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9.]{3,60})(?:[/?"'#\\]|$)/g },
  // linkedin.com/company/{slug}
  { platform: "linkedin", re: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9._-]{2,80})(?:[/?"'#\\]|$)/g },
  // youtube.com/@{handle} or /channel/{id} or /c/{name}
  { platform: "youtube", re: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)([A-Za-z0-9._-]{2,60})(?:[/?"'#\\]|$)/g },
  // x.com or twitter.com/{handle}
  { platform: "x", re: /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,15})(?:[/?"'#\\]|$)/g },
];

// Paths that match the URL shapes but are never brand profiles.
const NOISE = new Set([
  "sharer", "share", "intent", "hashtag", "explore", "reel", "reels", "p",
  "stories", "watch", "video", "videos", "embed", "plugins", "policy",
  "policies", "help", "legal", "about", "privacy", "tr", "home", "login",
  "signup", "search", "wix", "wordpress", "squarespace", "shopify",
]);

function canonicalProfileUrl(platform: string, handle: string): string {
  switch (platform) {
    case "instagram": return `https://www.instagram.com/${handle}/`;
    case "tiktok": return `https://www.tiktok.com/@${handle}`;
    case "facebook": return `https://www.facebook.com/${handle}`;
    case "linkedin": return `https://www.linkedin.com/company/${handle}/`;
    case "youtube": return `https://www.youtube.com/@${handle}`;
    default: return `https://x.com/${handle}`;
  }
}

/**
 * First plausible profile per platform wins — brand sites put their own
 * profiles in the header/footer, so the first hit is nearly always theirs.
 */
export function extractSocialHandles(html: string): DetectedHandle[] {
  const found = new Map<string, DetectedHandle>();
  for (const { platform, re } of PATTERNS) {
    re.lastIndex = 0; // shared module-level regexes are stateful with /g
    for (const m of html.matchAll(re)) {
      const handle = m[1];
      if (!handle || NOISE.has(handle.toLowerCase())) continue;
      if (!found.has(platform)) {
        found.set(platform, {
          platform,
          handle,
          profile_url: canonicalProfileUrl(platform, handle),
        });
      }
    }
  }
  return [...found.values()];
}
