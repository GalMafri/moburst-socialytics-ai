// A report's trend weeks: one rule wherever a report is read, so the API's
// report detail (socialytics-api/store.ts trendRows), the in-app social
// report (pipelines/social/storedTrends.ts), its deck and its insights all
// read the same weeks and posts:
//   * the client's finished weeks (done or partial) whose week_start falls
//     inside the report's period, both days included (a week that starts on
//     the last Monday of the month before is the month before's);
//   * the themes of those weeks staff did not dismiss;
//   * the kept posts those themes list, never one the tripwire flagged.
// trend_themes_in_range (20261108110000_trend_reads_fix.sql), which
// Analytics reads for any range, takes a week with any of its days in the
// range; a report reads only the weeks that start in its period.
//
// Read with the service role (a key or a pipeline has no signed-in user), so
// the rule is in the queries; each caller names the columns it may serve.
// Ids are read in groups, so no request line or answer grows past its limit.

// deno-lint-ignore no-explicit-any
type Db = any;

/** A trend week counts once it has finished, whole (done) or in part (partial). */
export const FINISHED_TREND_WEEKS = ["done", "partial"];
/** Ids per request: a uuid is 37 characters in a filter, and a group of 100 keeps the request line short and every answer under PostgREST's 1000 rows. */
export const TREND_IDS_PER_READ = 100;

/** The columns a caller reads from each table; the rule's own filters need none of them. */
export interface ReportTrendColumns { weeks: string; themes: string; posts: string }

export interface ReportTrendRows<W, T, P> { weeks: W[]; themes: T[]; posts: P[] }

function inGroups<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += TREND_IDS_PER_READ) out.push(xs.slice(i, i + TREND_IDS_PER_READ));
  return out;
}

async function rows<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/**
 * The rows of a report's trend weeks for the period from `start` to `end`
 * (dates): its weeks, their live themes, and the kept, unflagged posts the
 * themes list. A step that finds nothing asks for nothing more. A read that
 * fails throws: a report is never served with themes missing.
 */
export async function readReportTrendRows<W extends { id: string }, T extends { post_ids?: string[] | null }, P>(
  db: Db, clientId: string, start: string, end: string, columns: ReportTrendColumns,
): Promise<ReportTrendRows<W, T, P>> {
  const weeks = await rows<W>(db.from("trend_weeks").select(columns.weeks).eq("client_id", clientId).in("status", FINISHED_TREND_WEEKS).gte("week_start", start).lte("week_start", end));
  if (!weeks.length) return { weeks, themes: [], posts: [] };
  const themes = (await Promise.all(inGroups(weeks.map((w) => w.id)).map((ids) => rows<T>(db.from("trend_themes").select(columns.themes).eq("client_id", clientId).in("week_id", ids).is("dismissed_at", null))))).flat();
  const postIds = [...new Set(themes.flatMap((t) => t.post_ids ?? []))];
  if (!postIds.length) return { weeks, themes, posts: [] };
  const posts = (await Promise.all(inGroups(postIds).map((ids) => rows<P>(db.from("trend_posts").select(columns.posts).eq("client_id", clientId).eq("kept", true).eq("tripwire", false).in("id", ids))))).flat();
  return { weeks, themes, posts };
}
