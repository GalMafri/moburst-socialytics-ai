// The social report fixtures for tests: two real runs of the live n8n social
// workflow (version 5f8d3abc), as n8n recorded them.
//   social-moburst-2026-09.json  Moburst, September 2026, execution 574962
//                                (16 Oct 2026, report fd501cba): the brief,
//                                the four Sprout reads, every node's output,
//                                and the report as the app stored it.
//   social-trends-2026-09.json   execution 583953 (19 Oct 2026): the client
//                                settings the trend nodes read, the two raw
//                                scraper datasets, what the normalizers made.
// Not imported by any function.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// deno-lint-ignore no-explicit-any
type Any = any;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..", "..");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export const MOBURST: Any = read(join(here, "social-moburst-2026-09.json"));
export const TRENDS: Any = read(join(here, "social-trends-2026-09.json"));
/** The live workflow as the repo mirrors it (n8n/social-workflow.json). */
export const WORKFLOW: Any = read(join(root, "n8n", "social-workflow.json"));
export const nodeOf = (name: string): Any => {
  const node = WORKFLOW.nodes.find((n: Any) => n.name === name);
  if (!node) throw new Error(`The workflow has no node ${name}.`);
  return node;
};
export const nodeCode = (name: string): string => nodeOf(name).parameters.jsCode;
export const mirror = (file: string) => readFileSync(join(root, "n8n", "code", `${file}.js`), "utf8");

/**
 * The request n8n got for Moburst's report fd501cba, rebuilt from what
 * Combine Brief Context with Client Data read from it (every field that node
 * keeps) and the competitive context Attach Competitive Context read. withFile:
 * as sent on 16 Oct (with the Drive file id); without: as the app sends a
 * brief since 19 Oct, as text.
 */
export function moburstRequest(o: { withFile?: boolean } = {}): Any {
  const c = MOBURST.combine;
  return {
    report_id: c.report_id,
    client_name: c.client_name,
    sprout_customer_id: c.sprout_customer_id,
    profile_ids: c.profile_ids,
    profiles: c.profiles,
    social_keywords: c.social_keywords,
    trends_keywords: c.trends_keywords,
    content_pillars: c.content_pillars_full,
    primary_platforms: c.primary_platforms,
    geo: c.geo,
    languages: c.languages,
    brand_voice: c.brand_voice,
    brand_notes: c.brand_notes,
    brand_book_text: c.brand_book_text,
    brief_text: c.brief_text,
    ...(o.withFile ? { brief_file_id: c.brief_file_id } : {}),
    design_style_synthesis: c.design_style_synthesis,
    design_references: c.design_references,
    brand_book_file_path: c.brand_book_file_path,
    date_range_start: c.date_ranges.current_month.start,
    date_range_end: c.date_ranges.current_month.end,
    skip_trends: c.skip_trends,
    timezone: c.timezone,
    competitive_context: MOBURST.competitive_context,
  };
}

/** The four Sprout reads n8n made for Moburst's September report, as pages. */
export const moburstPages = () => ({
  current: MOBURST.sprout_pages.current,
  posts: MOBURST.sprout_pages.posts,
  previous: MOBURST.sprout_pages.previous,
  previous_posts: MOBURST.sprout_pages.previous_posts,
});
