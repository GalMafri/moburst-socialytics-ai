// supabase/functions/social-read/readers/types.ts
//
// What a public profile reader is. Each reader (instagram.ts, facebook.ts,
// tiktok.ts, linkedin.ts) is a small mapping file with no imports but this
// one's types, so the readers can move to the Vercel reader service of the
// 12 Nov design later without changes. A reader only says which Apify actor
// to run with which input, and how to read its answer; starting and looking
// at runs is the read job's (../readJob.ts).

export type SocialPlatform = "instagram" | "facebook" | "tiktok" | "linkedin";

/** An Apify actor as the read job starts it ("owner~name" works wherever an actor id does). */
export interface ReaderActor {
  id: string;
  name: string;
  timeoutSecs?: number;
  memoryMbytes?: number;
}

/** The profile a reader is asked about. */
export interface ReaderProfile {
  handle: string;
  /** The profile's address as the reader made it (profileUrl). */
  url: string;
}

/** The profile's own record, as one cheap profile read gives it. */
export interface ProfileRecord {
  /** The profile exists and answered. */
  found: boolean;
  /** The profile hides its posts. */
  private: boolean;
  /** A brand page (false: a personal Facebook profile, which is never read). */
  page: boolean;
  /** The name the profile shows. */
  name: string | null;
  /** The links the profile shows: its website field and bio links. */
  links: string[];
  /** The bio or about text. */
  bio: string;
  followers: number | null;
}

/** One post as a read gives it. */
export interface ReadPost {
  /** The platform's own id for the post. */
  key: string;
  publishedAt: string;
  url: string | null;
  text: string;
  /** image, carousel, video, reel, short_video, link, text. */
  format: string;
  hashtags: string[];
  /** The platform's own paid label; null where the answer does not show it. */
  paid: boolean | null;
  mediaUrl: string | null;
  /** Reactions on Facebook. null: hidden (Instagram) or not shown. */
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  /** The profile's followers, where the post carries them (TikTok). */
  followers: number | null;
}

export interface SocialReader {
  platform: SocialPlatform;
  /** The actor that reads the profile's own record (confirmation and followers). */
  profileActor: ReaderActor;
  /** The actor that reads the profile's posts. */
  postsActor: ReaderActor;
  /** The profile's address from a handle and a stored address, or "" when they make none. */
  profileUrl(handle: string, url: string | null): string;
  /** The handle the reader keys on, from the profile's address. */
  handleOf(url: string): string;
  profileInput(p: ReaderProfile): Record<string, unknown>;
  /** The profile's record in the profile run's answer, or null when the answer has none (not found, blocked). */
  profile(items: unknown[], p: ReaderProfile): ProfileRecord | null;
  /** The posts run's input: posts since a day (YYYY-MM-DD), at most max. */
  postsInput(p: ReaderProfile, since: string, max: number): Record<string, unknown>;
  /** The profile's own posts in the posts run's answer. */
  posts(items: unknown[], p: ReaderProfile): ReadPost[];
}
