// The shapes Trends shares: the platforms it watches, one post shape for every
// source, the trend profile the app writes for a client, and what Claude's
// filter and themes passes return.
// Spec: docs/superpowers/specs/2026-10-28-trends-redesign-design.md

export type TrendPlatform = "tiktok" | "instagram" | "linkedin" | "youtube" | "pinterest" | "facebook";
export const TREND_PLATFORMS: readonly TrendPlatform[] = ["tiktok", "instagram", "linkedin", "youtube", "pinterest", "facebook"];

/** The platforms a profile keeps hashtags for: Instagram's drive its search, TikTok's and LinkedIn's feed the calendar's suggestions. */
export type HashtagPlatform = "instagram" | "tiktok" | "linkedin";
export const HASHTAG_PLATFORMS: readonly HashtagPlatform[] = ["instagram", "tiktok", "linkedin"];

export type TrendFormat = "short_video" | "long_video" | "carousel" | "image" | "text" | "pin";
export const TREND_FORMATS: readonly TrendFormat[] = ["short_video", "long_video", "carousel", "image", "text", "pin"];

/** Why the rules in code left a post out, before Claude reads anything. */
export type RuleDrop = "duplicate" | "outside_window" | "language" | "own_or_competitor" | "over_cap";

/** Why Claude's filter left a post out. */
export type DropReason = "off_topic" | "scheme_or_spam" | "job_ad" | "giveaway" | "wrong_audience" | "own_or_competitor" | "low_quality";
export const DROP_REASONS: readonly DropReason[] = ["off_topic", "scheme_or_spam", "job_ad", "giveaway", "wrong_audience", "own_or_competitor", "low_quality"];

/** One post from any source, in the shape every later step reads. */
export interface TrendPost {
  platform: TrendPlatform;
  url: string;
  author: string;
  text: string;
  /** ISO time; null where the source gives no reliable date (Pinterest). */
  posted_at: string | null;
  format: TrendFormat | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagement: number;
  /** The search that found it. */
  search: string;
  /** The author's handle, where the source gives one beside a display name; only for telling tracked accounts apart, never saved. */
  handle?: string;
}

/** A topic, hashtag or exclusion, always with the reason it is there. */
export interface Term {
  term: string;
  reason: string;
  /** Who put it there: the client lifecycle, a person, or a dismissed theme. */
  source?: "lifecycle" | "person" | "dismissal";
}

/** What the app tracks for a client: written by Claude from the client's own data. */
export interface TrendProfile {
  audience: string;
  topics: Term[];
  hashtags: Record<HashtagPlatform, Term[]>;
  exclusions: Term[];
  fit_rubric: string;
  platforms: Array<{ platform: TrendPlatform; reason: string }>;
}

/** A post Claude's filter kept, with what it means for the brand. */
export interface KeptPost extends TrendPost {
  fit: number;
  why: string;
  format: TrendFormat;
  lesson: string;
}

/** One of the week's 3 to 6 themes. post_urls name kept posts. */
export interface Theme {
  title: string;
  happening: string;
  why_it_matters: string;
  angle: string;
  platforms: TrendPlatform[];
  post_urls: string[];
}
