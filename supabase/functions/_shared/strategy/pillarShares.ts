// A pillar's share of the client's calendar posts. Pure, with no Deno imports, so the edge code that writes
// the strategy (write.ts) and the strategy page compute the same numbers from the same rule.

/** A pillar's share is of the client's calendar posts over this many days (8 weeks), up to today. */
export const SHARE_DAYS = 56;
/** Fewer posts under a pillar of the strategy than this (a handful) say nothing about the mix: no share is given. */
export const PILLAR_SHARE_MIN_POSTS = 5;

/**
 * Each pillar's share of the client's calendar posts, as a whole percent.
 * A calendar post carries only the pillar's text, not an id, so a pillar
 * renamed since a post was planned cannot be followed. When any post in the
 * window carries a pillar text the strategy does not have, the mix cannot be
 * told and every share is null, rather than a division over the matched
 * subset. Null for every pillar too when fewer than PILLAR_SHARE_MIN_POSTS
 * posts carry a pillar. A post with no pillar says nothing and is left out.
 */
export function pillarShares(names: string[], posts: Array<{ pillar: string | null }>): Array<number | null> {
  const key = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const known = new Set(names.map(key));
  const carrying = posts.filter((p) => key(p.pillar));
  if (carrying.some((p) => !known.has(key(p.pillar)))) return names.map(() => null);
  if (carrying.length < PILLAR_SHARE_MIN_POSTS) return names.map(() => null);
  return names.map((n) => Math.round((100 * carrying.filter((p) => key(p.pillar) === key(n)).length) / carrying.length));
}

/** The days (yyyy-mm-dd, both included) a share is counted over: the last SHARE_DAYS days up to today. */
export function calendarShareWindow(now: Date): { start: string; end: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { start: day(new Date(now.getTime() - SHARE_DAYS * 86_400_000)), end: day(now) };
}
