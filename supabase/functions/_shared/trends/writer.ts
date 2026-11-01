// The week's writer: what trends_v1's save step hands over goes into
// trend_posts, trend_themes and the week's trend_weeks row. A run that is
// written again (a retried step) replaces the week's posts and themes.

import type { PipelineRun } from "../pipelines/types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

const CHUNK = 200;

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
    const posts = (data.posts ?? []) as Any[];
    const themes = (data.themes ?? []) as Any[];
    await must(db.from("trend_themes").delete().eq("week_id", weekId), "Could not clear the week's themes");
    await must(db.from("trend_posts").delete().eq("week_id", weekId), "Could not clear the week's posts");
    const idByUrl = new Map<string, string>();
    for (let i = 0; i < posts.length; i += CHUNK) {
      const chunk = posts.slice(i, i + CHUNK).map((p) => ({
        week_id: weekId, client_id: run.client_id,
        ...Object.fromEntries(POST_COLUMNS.map((c) => [c, p[c] ?? (c === "kept" || c === "tripwire" ? false : null)])),
      }));
      const inserted = await must(db.from("trend_posts").insert(chunk).select("id, url"), "Could not save the week's posts") as Array<{ id: string; url: string }>;
      for (const r of inserted ?? []) idByUrl.set(r.url, r.id);
    }
    if (themes.length) {
      await must(db.from("trend_themes").insert(themes.map((t, position) => ({
        week_id: weekId, client_id: run.client_id, position, title: t.title, happening: t.happening, why_it_matters: t.why_it_matters,
        angle: t.angle, platforms: t.platforms ?? [], post_ids: (t.post_urls ?? []).map((u: string) => idByUrl.get(u)).filter(Boolean),
      }))), "Could not save the week's themes");
    }
    await must(db.from("trend_weeks").update({
      status: data.status, platforms: data.platforms ?? {}, filter_status: data.filter_status ?? null, cost: data.cost ?? {}, finished_at: data.finished_at ?? new Date().toISOString(),
    }).eq("id", weekId), "Could not finish the week");
  },
};
