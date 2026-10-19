// supabase/functions/_shared/sprout/publishRules.ts
//
// What each network accepts in a post scheduled through Sprout, checked
// before anything is sent, so Sprout never refuses a post a person scheduled.
// The scheduling dialog checks the same rules as schedule-sprout-post, so the
// dialog shows what a post needs while it is being prepared and the server
// never sends one the network would refuse. Pure: no Deno, no network.

export interface PublishInput {
  /** The post's network as any source names it (Sprout network type, platform name). */
  network: string | null | undefined;
  text: string;
  mediaUrls: string[];
  /** When the post goes out (ISO). */
  sendAt?: string | null;
  now?: Date;
}

interface NetworkRule {
  name: string;
  maxChars: number;
  maxHashtags?: number;
  /** The post must carry media: any, or a video. */
  needs?: "media" | "video";
  maxMedia: number;
  /** At most one video, and a video is the only item. */
  singleVideo?: boolean;
}

const RULES: Record<string, NetworkRule> = {
  instagram: { name: "Instagram", maxChars: 2200, maxHashtags: 30, needs: "media", maxMedia: 10 },
  tiktok: { name: "TikTok", maxChars: 2200, needs: "video", maxMedia: 1 },
  facebook: { name: "Facebook", maxChars: 63206, maxMedia: 10 },
  linkedin: { name: "LinkedIn", maxChars: 3000, maxMedia: 9, singleVideo: true },
  x: { name: "X", maxChars: 280, maxMedia: 4, singleVideo: true },
  youtube: { name: "YouTube", maxChars: 5000, needs: "video", maxMedia: 1 },
  pinterest: { name: "Pinterest", maxChars: 500, needs: "media", maxMedia: 1 },
  threads: { name: "Threads", maxChars: 500, maxMedia: 10 },
};

/** One key per network, from a Sprout network type or a platform name. */
export function networkKey(value: string | null | undefined): string {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("insta")) return "instagram";
  if (v.includes("tiktok")) return "tiktok";
  if (v.includes("linkedin")) return "linkedin";
  if (v.includes("youtu")) return "youtube";
  if (v.includes("pinterest")) return "pinterest";
  if (v.includes("threads")) return "threads";
  if (v.includes("facebook") || v.startsWith("fb")) return "facebook";
  if (v === "x" || v.includes("twitter")) return "x";
  return v;
}

const VIDEO = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;
export const isVideoUrl = (url: string) => VIDEO.test(url) || /^data:video\//i.test(url);
const count = (n: number) => n.toLocaleString("en-US");

/**
 * What stops this post from being scheduled, as plain sentences about the
 * post. Empty when Sprout will take it.
 */
export function publishProblems(input: PublishInput): string[] {
  const rule = RULES[networkKey(input.network)];
  const text = String(input.text ?? "");
  const media = (input.mediaUrls ?? []).filter((u) => typeof u === "string" && u.trim());
  const out: string[] = [];
  if (!text.trim() && !media.length) out.push("The post has no copy yet.");
  // Sprout fetches each file from its address, so it has to be a web address.
  if (media.some((u) => !/^https:\/\//i.test(u))) out.push("One of the attached files has no web address Sprout can read.");
  if (input.sendAt) {
    const at = Date.parse(input.sendAt);
    if (!Number.isFinite(at)) out.push("The date and time are not complete.");
    else if (at <= (input.now ?? new Date()).getTime() + 60_000) out.push("The time has already passed.");
  }
  if (!rule) return out;
  const chars = [...text].length;
  if (chars > rule.maxChars) out.push(`The copy is ${count(chars)} characters. ${rule.name} takes up to ${count(rule.maxChars)}.`);
  const tags = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  if (rule.maxHashtags && tags > rule.maxHashtags) out.push(`The copy has ${tags} hashtags. ${rule.name} takes up to ${rule.maxHashtags}.`);
  const videos = media.filter(isVideoUrl).length;
  if (rule.needs === "media" && !media.length) out.push(`${rule.name} posts need an image or a video.`);
  if (rule.needs === "video" && !videos) out.push(`${rule.name} posts need a video.`);
  if (media.length > rule.maxMedia) out.push(`${media.length} files are attached. ${rule.name} takes up to ${rule.maxMedia}.`);
  if (rule.singleVideo && videos && media.length > 1) out.push(`${rule.name} takes a video on its own, without other files.`);
  return out;
}
