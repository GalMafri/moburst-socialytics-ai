// supabase/functions/social-read/readers/instagram.ts
//
// Instagram: the profile's record with apify/instagram-profile-scraper (the
// bio reader's actor, about USD 0.002 a profile) and its posts with
// apify/instagram-post-scraper at its basic data level (USD 0.0013 a post at
// Moburst's tier, read 25 Nov 2026). A like count the profile hides is
// unknown (null), never 0. Instagram shows no share count.

import type { ProfileRecord, ReaderProfile, ReadPost, SocialReader } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const count = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const RESERVED = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts"]);

export const instagramReader: SocialReader = {
  platform: "instagram",
  profileActor: { id: "apify~instagram-profile-scraper", name: "apify/instagram-profile-scraper", timeoutSecs: 120 },
  postsActor: { id: "apify~instagram-post-scraper", name: "apify/instagram-post-scraper", timeoutSecs: 600 },
  profileUrl(handle, url) {
    const h = (str(url).match(/instagram\.com\/([a-z0-9._]+)/i)?.[1] ?? str(handle)).replace(/^@/, "").toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(h) && !RESERVED.has(h) ? `https://www.instagram.com/${h}/` : "";
  },
  handleOf: (url) => (url.match(/instagram\.com\/([a-z0-9._]+)/i)?.[1] ?? "").toLowerCase(),
  profileInput: (p) => ({ usernames: [instagramReader.handleOf(p.url)] }),
  profile(items, p): ProfileRecord | null {
    const handle = instagramReader.handleOf(p.url);
    const o = (items as Any[]).find((i) => i && typeof i === "object" && !i.error && str(i.username).toLowerCase() === handle);
    if (!o) return null;
    const links = new Set<string>();
    const add = (v: unknown) => {
      const u = str(typeof v === "object" && v ? (v as Any).url : v);
      if (/^https?:\/\//i.test(u)) links.add(u);
    };
    add(o.externalUrl);
    if (Array.isArray(o.externalUrls)) o.externalUrls.forEach(add);
    return {
      found: true, private: o.private === true, page: true, name: str(o.fullName) || null, links: [...links],
      bio: str(o.biography).slice(0, 1000), followers: count(o.followersCount),
    };
  },
  postsInput: (p, since, max) => ({
    username: [instagramReader.handleOf(p.url)], resultsLimit: max, onlyPostsNewerThan: since, dataDetailLevel: "basicData", skipPinnedPosts: false,
  }),
  posts(items, p: ReaderProfile): ReadPost[] {
    const handle = instagramReader.handleOf(p.url);
    const out: ReadPost[] = [];
    for (const r of items as Any[]) {
      if (!r || typeof r !== "object" || r.error) continue;
      const owner = str(r.ownerUsername).toLowerCase();
      if (owner && owner !== handle) continue;
      const key = str(r.id) || str(r.shortCode);
      const at = iso(r.timestamp);
      if (!key || !at) continue;
      const type = str(r.type).toLowerCase();
      const format = type === "sidecar" ? "carousel" : type === "video" ? (str(r.productType) === "clips" ? "reel" : "video") : "image";
      out.push({
        key, publishedAt: at, url: str(r.url) || (str(r.shortCode) ? `https://www.instagram.com/p/${str(r.shortCode)}/` : null),
        text: str(r.caption), format, hashtags: Array.isArray(r.hashtags) ? r.hashtags.map(str).filter(Boolean) : [],
        paid: typeof r.paidPartnership === "boolean" ? r.paidPartnership : null, mediaUrl: str(r.displayUrl) || null,
        // Hidden likes come as -1 or not at all: unknown, never 0.
        likes: count(r.likesCount), comments: count(r.commentsCount), shares: null,
        views: format === "image" || format === "carousel" ? null : count(r.videoPlayCount ?? r.videoViewCount), followers: null,
      });
    }
    return out;
  },
};
