// supabase/functions/social-read/readers/index.ts
//
// The four public profile readers of release 1 (plan of 25 Nov 2026, decision
// 1): Instagram, Facebook, TikTok and LinkedIn through Apify. X is left out
// for now (Lital, 26 Nov), and competitors' YouTube channels are never read
// (YouTube's developer policy on comparing channels of different owners).

import { facebookReader } from "./facebook.ts";
import { instagramReader } from "./instagram.ts";
import { linkedinReader } from "./linkedin.ts";
import { tiktokReader } from "./tiktok.ts";
import type { SocialPlatform, SocialReader } from "./types.ts";

export type { ProfileRecord, ReaderProfile, ReadPost, SocialPlatform, SocialReader } from "./types.ts";

export const READERS: Record<SocialPlatform, SocialReader> = {
  instagram: instagramReader,
  facebook: facebookReader,
  tiktok: tiktokReader,
  linkedin: linkedinReader,
};

export const READ_PLATFORMS = Object.keys(READERS) as SocialPlatform[];

export const isReadPlatform = (p: unknown): p is SocialPlatform => typeof p === "string" && p in READERS;
