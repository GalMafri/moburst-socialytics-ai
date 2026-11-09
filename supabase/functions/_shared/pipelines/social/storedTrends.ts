// The monthly social report's industry trends (Trends plan, Task 16): the
// themes and kept posts the weekly trend collection stored for the client,
// for the weeks of the report's period. The report reads them instead of
// scraping TikTok and Instagram itself.
//
// The weeks, themes and posts are read by the one rule every reader of a
// report uses (trends/reportWeeks.ts; the API's report detail reads the
// same): the finished weeks that start in the period, newest week first and
// then by position; a theme staff dismissed is left out; a theme's posts are
// the kept ones it lists, in its order, never one the tripwire flagged.
//
// What is kept goes into report_data, which the client's own users read: the
// weighted engagement, the fit score, the filter's reasons and the lesson
// stay with the team.

import { readReportTrendRows } from "../../trends/reportWeeks.ts";
import { fenced } from "../../trends/text.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** A theme as the report keeps it. post_urls name the report's posts. */
export interface ReportTrendTheme {
  week_start: string;
  title: string;
  happening: string;
  why_it_matters: string;
  angle: string;
  platforms: string[];
  post_urls: string[];
}

/** A kept post as the report keeps it: what anyone may read on the post itself. */
export interface ReportTrendPost {
  platform: string;
  url: string;
  author: string;
  text: string;
  posted_at: string | null;
  format: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

/** report_data.industry_trends: the period's themes and every post they list, once each. */
export interface IndustryTrends {
  themes: ReportTrendTheme[];
  posts: ReportTrendPost[];
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(`${s.slice(0, 10)}T00:00:00Z`));
const text = (v: unknown) => (typeof v === "string" ? v : "");
const count = (v: unknown) => Number(v) || 0;

interface WeekRow { id: string; week_start: string }
interface ThemeRow { id: string; week_id: string; position: number; title: string; happening: string; why_it_matters: string; angle: string; platforms: string[] | null; post_ids: string[] | null }
type PostRow = { id: string } & Omit<ReportTrendPost, "posted_at" | "format"> & { posted_at: unknown; format: unknown };

/** What the report reads of each table: never a column the team keeps to itself. */
export const REPORT_TREND_COLUMNS = {
  weeks: "id, week_start",
  themes: "id, week_id, position, title, happening, why_it_matters, angle, platforms, post_ids",
  posts: "id, platform, url, author, text, posted_at, format, views, likes, comments, shares, saves",
};

/** The client's stored trends for the period from `from` to `to` (dates, both included), or null when no theme falls in it. */
export async function readStoredTrends(db: Db, clientId: string, from: string, to: string): Promise<IndustryTrends | null> {
  if (!isDay(from) || !isDay(to)) return null;
  const read = await readReportTrendRows<WeekRow, ThemeRow, PostRow>(db, clientId, from.slice(0, 10), to.slice(0, 10), REPORT_TREND_COLUMNS);
  const weekStart = new Map(read.weeks.map((w) => [String(w.id), String(w.week_start).slice(0, 10)]));
  const themes = read.themes.filter((t) => weekStart.has(String(t.week_id))).sort((a, b) => {
    const wa = weekStart.get(String(a.week_id))!, wb = weekStart.get(String(b.week_id))!;
    return wa === wb ? count(a.position) - count(b.position) : wa < wb ? 1 : -1;
  });
  if (!themes.length) return null;
  const byId = new Map(read.posts.filter((p) => text(p.url)).map((p) => [String(p.id), p]));

  const posts = new Map<string, ReportTrendPost>();
  const out: ReportTrendTheme[] = themes.map((t) => {
    const urls: string[] = [];
    for (const id of (t.post_ids ?? []).map(String)) {
      const p = byId.get(id);
      if (!p) continue;
      const url = text(p.url);
      if (!urls.includes(url)) urls.push(url);
      if (!posts.has(url)) {
        posts.set(url, {
          platform: text(p.platform), url, author: text(p.author), text: text(p.text), posted_at: p.posted_at == null ? null : String(p.posted_at), format: p.format == null ? null : String(p.format),
          views: count(p.views), likes: count(p.likes), comments: count(p.comments), shares: count(p.shares), saves: count(p.saves),
        });
      }
    }
    return {
      week_start: weekStart.get(String(t.week_id))!, title: text(t.title), happening: text(t.happening), why_it_matters: text(t.why_it_matters), angle: text(t.angle),
      platforms: (Array.isArray(t.platforms) ? t.platforms : []).map(String), post_urls: urls,
    };
  });
  return { themes: out, posts: [...posts.values()] };
}

/** Themes the report shows on its deck and asks Claude to name: the period's strongest, so a month of weekly themes stays a short list. */
export const REPORT_TREND_THEMES = 5;

/** A theme's title as two weeks' themes are matched: the same words, whatever the case or spacing. */
export const themeKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The period's strongest themes, a title that recurs across weeks merged
 * into one (the newest week's words, every platform and post it lists):
 * the most weeks first, then the most example posts, then the newest.
 */
export function strongestThemes(trends: IndustryTrends, limit = REPORT_TREND_THEMES): Array<ReportTrendTheme & { weeks: number }> {
  const merged = new Map<string, ReportTrendTheme & { weeks: number; order: number }>();
  trends.themes.forEach((t, order) => {
    const key = themeKey(t.title);
    const m = merged.get(key);
    if (!m) { merged.set(key, { ...t, platforms: [...t.platforms], post_urls: [...t.post_urls], weeks: 1, order }); return; }
    m.weeks += 1;
    for (const p of t.platforms) if (!m.platforms.includes(p)) m.platforms.push(p);
    for (const u of t.post_urls) if (!m.post_urls.includes(u)) m.post_urls.push(u);
  });
  return [...merged.values()].sort((a, b) => b.weeks - a.weeks || b.post_urls.length - a.post_urls.length || a.order - b.order)
    .slice(0, limit).map(({ order: _order, ...t }) => t);
}

/** Example posts Claude reads per theme. */
export const EXAMPLES_PER_THEME = 3;
/** Characters of an example post's text Claude reads. */
export const EXAMPLE_TEXT_CHARS = 300;

/**
 * The trends as the synthesis reads them (normalized.industry_trends): each
 * theme with up to three of its example posts, their text cut and made safe
 * (a stranger's text cannot open or close a tag), no links. Null for none.
 */
export function trendsForModel(trends: IndustryTrends | null | undefined) {
  if (!trends?.themes?.length) return null;
  const byUrl = new Map(trends.posts.map((p) => [p.url, p]));
  return {
    themes: trends.themes.map((t) => ({
      week_start: t.week_start, title: t.title, happening: t.happening, why_it_matters: t.why_it_matters, angle: t.angle, platforms: t.platforms,
      examples: t.post_urls.map((u) => byUrl.get(u)).filter((p): p is ReportTrendPost => !!p).slice(0, EXAMPLES_PER_THEME).map((p) => ({
        platform: p.platform, format: p.format, author: fenced(p.author, 80), text: fenced(p.text, EXAMPLE_TEXT_CHARS),
        likes: p.likes, comments: p.comments, shares: p.shares, views: p.views,
      })),
    })),
  };
}
