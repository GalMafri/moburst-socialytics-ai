// supabase/functions/_shared/brand-references/posts.ts
//
// The client's own designed posts, for the reads that need its posts and not
// its uploads: where its posts put the logo (lifecycle, design settings) and
// the brand read's images (lifecycle, social read). A library a person chose
// can hold uploads only (corpus.ts, rule 1), so these reads fall back to the
// client's reviewed designed posts. Where the logo sits is evidence any
// designed post gives, whatever it was made for, so that read takes them all;
// the brand read takes the everyday ones when there are any. Free of Deno and
// network imports so it can be tested.

import { platformName } from "../calendar/evidence.ts";

export interface BrandPost {
  path: string;
  platform: string | null;
  posted_at: string | null;
  source_post_id: string | null;
  quality_checked: true;
}

/**
 * The client's own designed posts, for reads that need its posts and not its uploads (where the logo sits, the brand read):
 * the library's posts; when the library holds none (a library a person chose from uploads), the client's reviewed designed
 * posts that no one left out, newest first, whatever they were made for (an occasion post shows where the logo sits as well
 * as any other). With `everydayFirst`, only the everyday ones when there are any (a brand read should not take its colors
 * from a holiday post while plainer ones exist).
 * Never throws: with nothing to read it answers [].
 */
// deno-lint-ignore no-explicit-any
export async function brandPosts(db: any, client: { id: string; harvested_design_references?: unknown }, limit = 16, opts: { everydayFirst?: boolean } = {}): Promise<BrandPost[]> {
  // The library's own posts, as they are stored and in stored order.
  const stored = (Array.isArray(client.harvested_design_references) ? client.harvested_design_references : [])
    .filter((r: { path?: unknown; upload?: unknown } | null) => !!r && typeof r === "object" && typeof r.path === "string" && !!r.path && r.upload !== true);
  if (stored.length) return stored as BrandPost[];
  try {
    // The posts a person left out first, so the read can ask for that many more.
    const { data: choices, error: choicesError } = await db.from("design_reference_choices").select("path").eq("client_id", client.id).eq("choice", "left_out");
    if (choicesError) return [];
    const left = new Set((choices ?? []).map((c: { path: string }) => c.path));
    const read = async (everyday: boolean): Promise<BrandPost[]> => {
      let query = db.from("design_reference_reviews").select("path, network, posted_at, source_post_id").eq("client_id", client.id).eq("verdict", "designed");
      if (everyday) query = query.eq("kind", "everyday");
      const { data, error } = await query.order("posted_at", { ascending: false }).limit(limit + left.size);
      if (error || !Array.isArray(data)) return [];
      const seen = new Set<string>();
      const out: BrandPost[] = [];
      for (const r of data as Array<{ path: string | null; network: string | null; posted_at: string | null; source_post_id: string | null }>) {
        if (!r?.path || left.has(r.path) || seen.has(r.path)) continue;
        seen.add(r.path);
        out.push({ path: r.path, platform: platformName(r.network) || null, posted_at: r.posted_at ?? null, source_post_id: r.source_post_id ?? null, quality_checked: true });
      }
      return out.slice(0, Math.max(0, limit));
    };
    if (opts.everydayFirst) {
      const everyday = await read(true);
      if (everyday.length) return everyday;
    }
    return await read(false);
  } catch {
    return [];
  }
}
