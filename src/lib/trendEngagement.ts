/**
 * Likes, comments and shares added up: the measured figure a client sees on a
 * trending post in place of the weighted engagement score, which is an
 * internal ranking (staff still see it). Null when none of the three is known.
 */
export function measuredEngagements(post: { likes?: unknown; comments?: unknown; shares?: unknown }): number | null {
  const parts = [post.likes, post.comments, post.shares].filter((v) => v != null && v !== "" && Number.isFinite(Number(v))).map(Number);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}
