// The writers of trends_v1.
// week: what the save step hands over goes into trend_posts, trend_themes and
// the week's trend_weeks row, in one transaction in the database
// (trend_week_write, 20261117160000_trend_week_write.sql). A week is written
// more than once (a retried step, a replay, a failed source collected again
// after people have looked at the week), so a reader sees the week as it was
// or as it is now, never in between, and a write that fails leaves it as it
// was. A post is matched by its link, so none is stored twice. A theme a
// person dismissed stays as it is, and a new theme with its title is left out.
// sources: what a run that collected failed sources again learned without
// writing the week again: a source that answered with no posts, the fault a
// source failed with again, and what the try cost.
// searches: the coverage rewrite of one platform's searches, kept in the
// client's trend profile for the weeks to come.

import type { PipelineRun } from "../pipelines/types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

const POST_COLUMNS = ["platform", "url", "author", "text", "posted_at", "format", "views", "likes", "comments", "shares", "saves", "engagement", "search", "kept", "drop_reason", "fit", "why", "lesson", "tripwire"];

export const TREND_WRITERS: Record<string, (db: Db, run: PipelineRun, data: Record<string, unknown>) => Promise<void>> = {
  async week(db, run, data) {
    const weekId = run.real_id;
    if (!weekId) throw new Error("A trends run must point at its week.");
    const posts = ((data.posts ?? []) as Any[]).map((p) => Object.fromEntries(POST_COLUMNS.map((c) => [c, p[c] ?? (c === "kept" || c === "tripwire" ? false : null)])));
    const themes = ((data.themes ?? []) as Any[]).map((t) => ({
      title: t.title, happening: t.happening, why_it_matters: t.why_it_matters, angle: t.angle, platforms: t.platforms ?? [], post_urls: t.post_urls ?? [],
    }));
    await must(db.rpc("trend_week_write", {
      p_week: weekId, p_client: run.client_id, p_posts: posts, p_themes: themes, p_status: data.status, p_platforms: data.platforms ?? {},
      p_filter_status: data.filter_status ?? null, p_cost: data.cost ?? {}, p_finished_at: data.finished_at ?? new Date().toISOString(),
    }), "Could not save the week");
  },

  /**
   * What a run that collected failed sources again learned without writing
   * the week again. Each platform's entry is merged into what the week holds
   * for it (a null value takes a key away): a source that answered with no
   * posts is recorded as answered, a source that failed again keeps its
   * state with the fault it failed with. `status`, when given, is the
   * week's status now (the run works it out); `cost` is what the week has
   * cost with this try in it; `finished_at` moves only when a source
   * answered. The week's posts and themes are not touched. Only a partial
   * week is changed.
   */
  async sources(db, run, data) {
    const weekId = run.real_id;
    if (!weekId) throw new Error("A trends run must point at its week.");
    if (data.status !== undefined && data.status !== "done" && data.status !== "partial") throw new Error("The week's status must be done or partial.");
    const week = await must(db.from("trend_weeks").select("status, platforms").eq("id", weekId).maybeSingle(), "Could not read the week") as
      { status: string; platforms: Record<string, Any> | null } | null;
    if (!week || week.status !== "partial") return;
    const platforms: Record<string, Any> = { ...(week.platforms ?? {}) };
    for (const [platform, state] of Object.entries((data.platforms ?? {}) as Record<string, Record<string, unknown>>)) {
      const merged: Record<string, unknown> = { ...(platforms[platform] ?? {}), ...state };
      for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key];
      platforms[platform] = merged;
    }
    await must(db.from("trend_weeks").update({
      platforms, ...(data.status ? { status: data.status } : {}), ...(data.cost ? { cost: data.cost } : {}), ...(data.finished_at ? { finished_at: data.finished_at } : {}),
    }).eq("id", weekId).eq("status", "partial"), "Could not record what the try learned");
  },

  /**
   * One platform's rewritten searches, into trend_profiles.search_overrides
   * beside the other platforms', merged in the database
   * (trend_search_override_put, 20261110180000_trend_merges_and_share.sql) so a
   * "Go back" on another platform in between stays. Written only while the
   * profile the run read stands: a profile written since cleared the overrides
   * on purpose, since they were made from the old one. Instagram searches by
   * the profile's hashtags, so its rewrite is also written only while the
   * hashtags the run read stand: the monthly refresh replaces them and clears
   * that rewrite.
   */
  async searches(db, run, data) {
    const platform = String(data.platform ?? "");
    const searches = Array.isArray(data.searches) ? (data.searches as unknown[]).map(String) : [];
    if (!platform || !searches.length) throw new Error("A search rewrite must name its platform and its searches.");
    const written = String(data.profile_written_at ?? "");
    if (!written) return;
    await must(db.rpc("trend_search_override_put", {
      p_client: run.client_id, p_platform: platform, p_searches: searches, p_written_at: written,
      p_hashtags_at: String(data.profile_hashtags_at ?? "") || null, p_check_hashtags: platform === "instagram",
    }), "Could not save the rewritten searches");
  },
};
