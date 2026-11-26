// supabase/functions/social-read/readers/linkedin.ts
//
// LinkedIn: the company page's record with harvestapi/linkedin-company (the
// onboarding page reader's actor) and its posts with
// harvestapi/linkedin-company-posts (the competitor feed's LinkedIn source,
// USD 0.00175 a post at Moburst's tier, read 25 Nov 2026), with the feed's
// checks: the page's own post or a collaboration it shows, never a repost.
// LinkedIn shows no views and no paid label.

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
/** A company page's address in one form, or "" when the value is not one. */
const page = (v: unknown) => {
  const m = str(v).match(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([a-z0-9_-]+)(?:\/|\?|$)/i);
  return m ? `https://www.linkedin.com/company/${m[1].toLowerCase()}` : "";
};
const hashtagsOf = (text: string) => [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]);

export const linkedinReader: SocialReader = {
  platform: "linkedin",
  profileActor: { id: "harvestapi~linkedin-company", name: "harvestapi/linkedin-company", timeoutSecs: 120 },
  postsActor: { id: "WI0tj4Ieb5Kq458gB", name: "harvestapi/linkedin-company-posts", timeoutSecs: 600, memoryMbytes: 512 },
  profileUrl: (handle, url) => page(url) || (/^[a-z0-9_-]+$/i.test(str(handle)) ? page(`https://www.linkedin.com/company/${str(handle)}`) : ""),
  handleOf: (url) => (page(url).match(/\/company\/([a-z0-9_-]+)/)?.[1] ?? ""),
  profileInput: (p) => ({ companies: [p.url] }),
  profile(items, p): ProfileRecord | null {
    const wanted = linkedinReader.handleOf(p.url);
    const o = (items as Any[]).find((i) => i && typeof i === "object" && !i.error && (!str(i.universalName) || str(i.universalName).toLowerCase() === wanted));
    if (!o) return null;
    const website = str(o.website);
    return {
      found: true, private: false, page: true, name: str(o.name) || null, links: website ? [website] : [],
      bio: [str(o.tagline), str(o.description)].filter(Boolean).join("\n").slice(0, 1000), followers: count(o.followerCount ?? o.followersCount ?? o.followers),
    };
  },
  postsInput: (p, since, max) => ({
    targetUrls: [p.url], maxPosts: max, postedLimitDate: since, scrapeComments: false, scrapeReactions: false, includeReposts: false, includeQuotePosts: true,
  }),
  posts(items, p: ReaderProfile): ReadPost[] {
    const target = page(p.url);
    const out: ReadPost[] = [];
    for (const r of items as Any[]) {
      if (!r || typeof r !== "object" || r.type !== "post") continue;
      const header = page(r.header?.imageLink) === target;
      if (header && /reposted this/i.test(str(r.header?.text))) continue;
      const collaboration = header && /collaborated on this/i.test(str(r.header?.text));
      if (page(r.author?.linkedinUrl) !== target && !collaboration) continue;
      const at = iso(r.postedAt?.date ?? r.postedAt?.timestamp);
      const link = str(r.linkedinUrl);
      const key = str(r.id) || link;
      if (!at || !key) continue;
      const image = str(r.postImages?.[0]?.url);
      const text = str(r.content);
      out.push({
        key, publishedAt: at, url: /^https:\/\/www\.linkedin\.com\//.test(link) ? link : null, text,
        format: r.document ? "carousel" : r.postVideo ? "video" : r.article ? "link" : image ? "image" : "text",
        hashtags: hashtagsOf(text), paid: null, mediaUrl: image || null,
        likes: count(r.engagement?.likes), comments: count(r.engagement?.comments), shares: count(r.engagement?.shares), views: null, followers: null,
      });
    }
    return out;
  },
};
