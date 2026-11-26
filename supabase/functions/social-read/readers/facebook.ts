// supabase/functions/social-read/readers/facebook.ts
//
// Facebook: the page's record with apify/facebook-pages-scraper (its name,
// website, about text and followers) and its posts with
// apify/facebook-posts-scraper (USD 0.0025 a post, 0.0008 for the date
// filter and 0.001 a run at Moburst's tier, read 25 Nov 2026). Both read
// pages only: a personal profile is never read (page: false). Facebook's
// likes are the post's reactions; views are shown on video only; there is no
// paid label in the answer, so paid stays unknown unless it says so.

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
const RESERVED = new Set(["sharer", "sharer.php", "share", "pages", "groups", "events", "watch", "profile.php", "people", "marketplace", "login", "help", "policies", "hashtag", "reel", "reels", "story.php", "permalink.php"]);
const slug = (url: string) => (url.match(/facebook\.com\/([A-Za-z0-9.\-_]+)/i)?.[1] ?? "").toLowerCase();
const hashtagsOf = (text: string) => [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]);

export const facebookReader: SocialReader = {
  platform: "facebook",
  profileActor: { id: "apify~facebook-pages-scraper", name: "apify/facebook-pages-scraper", timeoutSecs: 180 },
  postsActor: { id: "apify~facebook-posts-scraper", name: "apify/facebook-posts-scraper", timeoutSecs: 900 },
  profileUrl(handle, url) {
    const h = slug(str(url)) || str(handle).replace(/^@/, "").toLowerCase();
    return /^[a-z0-9.\-_]{2,80}$/.test(h) && !RESERVED.has(h) ? `https://www.facebook.com/${h}` : "";
  },
  handleOf: (url) => slug(url),
  profileInput: (p) => ({ startUrls: [{ url: p.url }] }),
  profile(items, p): ProfileRecord | null {
    const wanted = slug(p.url);
    const rows = (items as Any[]).filter((i) => i && typeof i === "object" && !i.error);
    const o = rows.find((i) => [i.facebookUrl, i.pageUrl].some((u) => slug(str(u)) === wanted)) ?? (rows.length === 1 ? rows[0] : null);
    if (!o) return null;
    // The actor answers a personal profile with personalProfile and no page fields.
    if (o.personalProfile && !str(o.title) && !str(o.pageId)) return { found: true, private: false, page: false, name: null, links: [], bio: "", followers: null };
    const links = new Set<string>();
    const add = (v: unknown) => {
      const u = str(typeof v === "object" && v ? (v as Any).url ?? (v as Any).website : v);
      if (u) links.add(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    };
    if (Array.isArray(o.website)) o.website.forEach(add); else add(o.website);
    if (Array.isArray(o.websites)) o.websites.forEach(add);
    const bio = [str(o.intro), ...(Array.isArray(o.info) ? o.info.map(str) : [])].filter(Boolean).join("\n");
    return { found: true, private: false, page: true, name: str(o.title) || null, links: [...links], bio: bio.slice(0, 1000), followers: count(o.followers ?? o.likes) };
  },
  postsInput: (p, since, max) => ({ startUrls: [{ url: p.url }], resultsLimit: max, onlyPostsNewerThan: since, captionText: false }),
  posts(items, _p: ReaderProfile): ReadPost[] {
    const out: ReadPost[] = [];
    for (const r of items as Any[]) {
      if (!r || typeof r !== "object" || r.error) continue;
      const key = str(r.postId);
      const at = iso(r.time) ?? iso(r.timestamp);
      if (!key || !at) continue;
      const media = Array.isArray(r.media) ? r.media : [];
      const photos = media.filter((m: Any) => str(m?.__typename) === "Photo").length;
      const format = r.isVideo ? "video" : photos > 1 ? "carousel" : photos === 1 ? "image" : str(r.link) ? "link" : "text";
      const text = str(r.text);
      out.push({
        key, publishedAt: at, url: str(r.url) || null, text, format, hashtags: hashtagsOf(text),
        paid: typeof r.paidPartnership === "boolean" ? r.paidPartnership : null,
        mediaUrl: str(media[0]?.thumbnail) || str(media[0]?.url) || null,
        likes: count(r.likes ?? r.topReactionsCount), comments: count(r.comments), shares: count(r.shares),
        views: r.isVideo ? count(r.viewsCount ?? r.videoPostViewCount) : null, followers: null,
      });
    }
    return out;
  },
};
