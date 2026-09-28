export interface Candidate {
  source_post_id: string;
  source_url: string;
  profile_id: string;
  platform: string;
  posted_at: string;
  image_url: string;
}

/** Only published media from the client's assigned accounts, never inbox or competitor images. */
export function sproutCandidates(rows: any[], profileIds: string[]): Candidate[] {
  const allowed = new Set(profileIds);
  const seen = new Set<string>();
  return rows.flatMap((p): Candidate[] => {
    const profile = String(p.customer_profile_id ?? p.dimensions?.customer_profile_id ?? "");
    if (!allowed.has(profile) || p.sent !== true || !p.guid || !p.perma_link) return [];
    if (!['PHOTO', 'ALBUM'].includes(String(p.content_category).toUpperCase())) return [];
    // One frame per post prevents one carousel from defining the entire brand.
    const media = (Array.isArray(p.visual_media) ? p.visual_media : []).find((m: any) =>
      String(m.media_type).toUpperCase() === 'PHOTO' && typeof m.media_url === 'string');
    if (!media || seen.has(media.media_url)) return [];
    seen.add(media.media_url);
    return [{ source_post_id: String(p.guid), source_url: String(p.perma_link), profile_id: profile,
      platform: String(p.network || ''), posted_at: String(p.created_time || ''), image_url: media.media_url }];
  }).sort((a, b) => b.posted_at.localeCompare(a.posted_at));
}

export function usableClassification(value: any): boolean {
  return value?.usable === true && typeof value?.confidence === 'number' && value.confidence >= 0.8
    && typeof value?.reason === 'string' && value.reason.length > 0;
}

export function referenceFingerprint(profileIds: string[], customer: string): string {
  return `${customer}:${[...new Set(profileIds)].sort().join(',')}`;
}
