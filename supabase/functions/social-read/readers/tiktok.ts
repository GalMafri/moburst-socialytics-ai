// supabase/functions/social-read/readers/tiktok.ts
//
// TikTok: clockworks/tiktok-profile-scraper for both the profile's record
// (one post asked for: its author block has the name, bio, bio link and
// followers) and its posts (USD 0.0023 a post at Moburst's tier, read 25 Nov
// 2026). Each post carries the author's followers. The platform's own labels
// (isAd, isSponsored) are the paid label.

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
const handleIn = (url: string) => (url.match(/tiktok\.com\/@([a-z0-9._]+)/i)?.[1] ?? "").toLowerCase();
const QUIET = { shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSlideshowImages: false, shouldDownloadAvatars: false, downloadSubtitlesOptions: "NEVER_DOWNLOAD_SUBTITLES", profileScrapeSections: ["videos"], profileSorting: "latest" };

export const tiktokReader: SocialReader = {
  platform: "tiktok",
  profileActor: { id: "clockworks~tiktok-profile-scraper", name: "clockworks/tiktok-profile-scraper", timeoutSecs: 180 },
  postsActor: { id: "clockworks~tiktok-profile-scraper", name: "clockworks/tiktok-profile-scraper", timeoutSecs: 600 },
  profileUrl(handle, url) {
    const h = handleIn(str(url)) || str(handle).replace(/^@/, "").toLowerCase();
    return /^[a-z0-9._]{2,24}$/.test(h) ? `https://www.tiktok.com/@${h}` : "";
  },
  handleOf: handleIn,
  profileInput: (p) => ({ profiles: [handleIn(p.url)], resultsPerPage: 1, ...QUIET }),
  profile(items, p): ProfileRecord | null {
    const handle = handleIn(p.url);
    const rows = (items as Any[]).filter((i) => i && typeof i === "object");
    const author = rows.map((r) => r.authorMeta).find((a) => a && str(a.name).toLowerCase() === handle);
    if (!author) {
      // A private or empty profile answers with a note and no posts.
      const note = rows.find((r) => /private/i.test(str(r.note)) && (!str(r.input) || str(r.input).toLowerCase().includes(handle)));
      return note ? { found: true, private: true, page: true, name: null, links: [], bio: "", followers: null } : null;
    }
    const link = str(author.bioLink);
    return {
      found: true, private: author.privateAccount === true, page: true, name: str(author.nickName) || null,
      links: link ? [/^https?:\/\//i.test(link) ? link : `https://${link}`] : [], bio: str(author.signature).slice(0, 1000), followers: count(author.fans),
    };
  },
  postsInput: (p, since, max) => ({ profiles: [handleIn(p.url)], resultsPerPage: max, oldestPostDateUnified: since, excludePinnedPosts: false, ...QUIET }),
  posts(items, p: ReaderProfile): ReadPost[] {
    const handle = handleIn(p.url);
    const out: ReadPost[] = [];
    for (const r of items as Any[]) {
      if (!r || typeof r !== "object" || r.error || r.isStory) continue;
      if (r.fromProfileSection && r.fromProfileSection !== "videos") continue;
      if (str(r.authorMeta?.name).toLowerCase() !== handle) continue;
      const key = str(r.id);
      const at = iso(r.createTimeISO) ?? iso(r.createTime);
      if (!key || !at) continue;
      out.push({
        key, publishedAt: at, url: str(r.webVideoUrl) || null, text: str(r.text), format: r.isSlideshow ? "carousel" : "short_video",
        hashtags: Array.isArray(r.hashtags) ? r.hashtags.map((h: Any) => str(h?.name)).filter(Boolean) : [],
        paid: typeof r.isAd === "boolean" || typeof r.isSponsored === "boolean" ? r.isAd === true || r.isSponsored === true : null,
        mediaUrl: str(r.videoMeta?.coverUrl) || null,
        likes: count(r.diggCount), comments: count(r.commentCount), shares: count(r.shareCount), views: count(r.playCount),
        followers: count(r.authorMeta?.fans),
      });
    }
    return out;
  },
};
