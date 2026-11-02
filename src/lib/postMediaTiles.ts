export interface Iteration {
  id?: string;
  media_urls?: string[] | null;
  variant_angle?: string | null;
  finishing?: string | null;
  is_selected?: boolean | null;
  variant_group_id?: string | null;
  created_at?: string | null;
}

export interface MediaTile {
  iterationId?: string;
  url: string;
  isSelected: boolean;
  /** The row's variant label; design options read "Design option N". */
  variantAngle?: string | null;
}

/**
 * Resolve which variant group to display: most recent one with media. Return
 * one tile per (iteration row × url) pair so multi-url rows (carousels) all
 * surface. Falls back gracefully if no group is present.
 */
export function tilesFromIterations(
  iterations: Iteration[],
  filter: (url: string) => boolean,
): MediaTile[] {
  if (!iterations || iterations.length === 0) return [];

  // Bucket by variant_group_id (or per-row when no group).
  const byGroup = new Map<string, Iteration[]>();
  for (const it of iterations) {
    if (!it.media_urls?.some(filter)) continue;
    const key = it.variant_group_id || `solo:${it.id}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(it);
  }

  // Find the group whose latest member is the most recent overall.
  let bestGroup: Iteration[] | null = null;
  let bestTs = "";
  for (const group of byGroup.values()) {
    const ts = group
      .map((it) => it.created_at || "")
      .sort()
      .reverse()[0];
    if (ts > bestTs) {
      bestTs = ts;
      bestGroup = group;
    }
  }
  if (!bestGroup) return [];

  // Stable order: created_at asc so variant #1 lands first, then variant #2, etc.
  const ordered = [...bestGroup].sort((a, b) =>
    (a.created_at || "").localeCompare(b.created_at || ""),
  );

  const tiles: MediaTile[] = [];
  for (const it of ordered) {
    for (const url of it.media_urls || []) {
      if (!filter(url)) continue;
      tiles.push({
        iterationId: it.id,
        url,
        isSelected: !!it.is_selected,
        ...(it.variant_angle ? { variantAngle: it.variant_angle } : {}),
      });
    }
  }
  return tiles;
}


const DESIGN_OPTION = /^Design option \d+$/;

/**
 * The media a post goes out with: every row in use for it (oldest first, a
 * carousel's slides in their order), else the post's newest design, the one
 * its Design tab shows. The board keeps one design in use per post, so this
 * is the design the team sees, whichever group it came from.
 */
export function mediaInUse(iterations: Iteration[]): string[] {
  const withMedia = (iterations ?? []).filter((it) => (it.media_urls ?? []).length > 0);
  const byAge = (a: Iteration, b: Iteration) => (a.created_at || "").localeCompare(b.created_at || "");
  const inUse = withMedia.filter((it) => it.is_selected).sort(byAge);
  if (inUse.length) return inUse.flatMap((it) => it.media_urls ?? []);
  const newestDesign = withMedia.filter((it) => DESIGN_OPTION.test(String(it.variant_angle ?? ""))).sort(byAge).at(-1);
  return newestDesign?.media_urls ?? [];
}
