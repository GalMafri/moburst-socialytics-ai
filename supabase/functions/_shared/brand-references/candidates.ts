import { platformName } from "../calendar/evidence.ts";

export interface Candidate {
  source_post_id: string;
  source_url: string;
  profile_id: string;
  /** Sprout's network, as it sends it ("INSTAGRAM", "LINKEDIN_COMPANY"). */
  network: string;
  /** The platform, named the calendar's way (Instagram, LinkedIn, Facebook, TikTok, X). */
  platform: string;
  posted_at: string;
  image_url: string;
}

/** Input must come from Sprout analytics/posts (owned published posts), never messages/inbox.
 * The posts endpoint does not accept the documented `sent` field. Bind every
 * returned profile to the saved assignment and reject explicit received rows.
 * Organic designed posts only, newest first by the date they were posted,
 * never by how many people saw them.
 */
export function sproutCandidates(rows: any[], profileIds: string[]): Candidate[] {
  const allowed = new Set(profileIds);
  const seen = new Set<string>();
  return rows.flatMap((p): Candidate[] => {
    const profile = String(p.customer_profile_id ?? p.dimensions?.customer_profile_id ?? "");
    if (!allowed.has(profile) || p.sent === false || !p.guid || !p.perma_link) return [];
    // Paid reach is not the brand's own look of the moment: boosted posts are left out, as the calendar leaves them out.
    if (p.is_boosted === true) return [];
    // Stories are not feed designs, and their media has usually expired by the time it is read.
    if (/^igst:/i.test(String(p.guid))) return [];
    if (!['PHOTO', 'ALBUM'].includes(String(p.content_category).toUpperCase())) return [];
    // One frame per post prevents one carousel from defining the entire brand.
    const media = (Array.isArray(p.visual_media) ? p.visual_media : []).find((m: any) =>
      String(m.media_type).toUpperCase() === 'PHOTO' && typeof m.media_url === 'string');
    if (!media || seen.has(media.media_url)) return [];
    seen.add(media.media_url);
    const network = String(p.network || '');
    return [{ source_post_id: String(p.guid), source_url: String(p.perma_link), profile_id: profile,
      network, platform: platformName(network), posted_at: String(p.created_time || ''), image_url: media.media_url }];
  }).sort((a, b) => b.posted_at.localeCompare(a.posted_at));
}

export function usableClassification(value: any): boolean {
  return value?.usable === true && typeof value?.confidence === 'number' && value.confidence >= 0.8
    && typeof value?.reason === 'string' && value.reason.length > 0;
}

export function referenceFingerprint(profileIds: string[], customer: string): string {
  return `${customer}:${[...new Set(profileIds)].sort().join(',')}`;
}
