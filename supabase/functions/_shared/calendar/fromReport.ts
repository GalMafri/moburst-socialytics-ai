// supabase/functions/_shared/calendar/fromReport.ts
//
// The posts a monthly report planned, as calendar rows. The calendar is its
// own tab (Lital, 12 and 13 Oct); a report only plans posts into it.
//
// Each imported post keeps the key the report's board used for it, so the
// copy edits, designs and approvals already attached to it stay attached.
// That key must match src/lib/calendarRevision.ts exactly; a test holds the
// two together.

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const LEAKED_FIELDS = ["language", "platform", "format", "pillar", "posting_time", "hashtags", "visual_direction", "ai_visual_prompt", "rationale"];
const LEADING_FIELD = new RegExp(`^[ \\t]*(?:${LEAKED_FIELDS.join("|")})[ \\t]*:[ \\t]*[^\\n]{0,60}(?:\\n|$)`, "i");

/** Same as cleanPostCopy in src/lib/postCopy.ts. */
export function cleanPostCopy(raw: string | null | undefined): string {
  let out = String(raw ?? "");
  for (let i = 0; i < LEAKED_FIELDS.length && LEADING_FIELD.test(out); i++) out = out.replace(LEADING_FIELD, "");
  return out.trimStart();
}

/** Same as postCopyOf in src/lib/postCopy.ts. */
export function postCopyOf(post: { copy?: string | null; caption_angle?: string | null; concept?: string | null } | null | undefined): string {
  return cleanPostCopy(post?.copy || post?.caption_angle || post?.concept || "");
}

/** The key the report's board gives a post (calendarWithRevisions). */
export function reportPostKey(reportId: string, dayIndex: number, postIndex: number, day: { day?: string; date_label?: string }, post: { platform?: string } & Record<string, unknown>): string {
  return JSON.stringify([reportId, dayIndex, postIndex, day.day, day.date_label, post.platform, postCopyOf(post as never)]);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The Monday a "Week of …" label names. Reports write it as "Week of Oct 12,
 * 2026", "Week of 2026-10-12", "Week of July 13, 2026" or "Week of Oct 12"
 * (no year: the year that puts it nearest the report's date). Null when the
 * label names no date.
 */
export function weekStart(label: string | undefined, reportCreatedAt: string): string | null {
  const text = String(label ?? "").replace(/^\s*week of\s*/i, "").trim();
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const m = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const day = Number(m[2]);
  const created = new Date(reportCreatedAt);
  let year = m[3] ? Number(m[3]) : created.getUTCFullYear();
  let d = new Date(Date.UTC(year, month, day));
  if (!m[3]) {
    // Nearest to the report: a December report planning "Jan 5" means next year.
    const diff = d.getTime() - created.getTime();
    if (diff < -182 * 86400000) d = new Date(Date.UTC(++year, month, day));
    else if (diff > 182 * 86400000) d = new Date(Date.UTC(--year, month, day));
  }
  return iso(d);
}

/** The Monday on or after a date, for a report whose labels name no week. */
export function nextMonday(fromIso: string): string {
  const d = new Date(fromIso);
  const day = d.getUTCDay();
  const add = day === 1 ? 0 : (8 - day) % 7;
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add)));
}

export interface CalendarPostRow {
  client_id: string;
  report_id: string;
  post_date: string;
  posting_time: string | null;
  platform: string;
  format: string | null;
  pillar: string | null;
  copy: string;
  hashtags: string[];
  cta: string | null;
  visual_direction: string | null;
  rationale: string | null;
  language: string | null;
  reasons: Array<{ type: string; label: string; report_id?: string }>;
  source: "report";
  post_key: string;
  raw: Record<string, unknown>;
}

/** Every post the report planned, dated, keyed as its board keyed it. */
export function postsFromReport(report: { id: string; client_id: string; created_at: string; report_data: unknown }): CalendarPostRow[] {
  const data = Array.isArray(report.report_data) ? report.report_data[0] : report.report_data;
  const calendar = (data as any)?.content_calendar || (data as any)?.ai_analysis?.content_calendar;
  if (!Array.isArray(calendar)) return [];
  const rows: CalendarPostRow[] = [];
  calendar.forEach((day: any, dayIndex: number) => {
    const offset = DAYS.indexOf(String(day?.day ?? ""));
    const monday = weekStart(day?.date_label, report.created_at) ?? nextMonday(report.created_at);
    const base = new Date(`${monday}T00:00:00Z`);
    const date = iso(new Date(base.getTime() + Math.max(0, offset) * 86400000));
    (Array.isArray(day?.posts) ? day.posts : []).forEach((post: any, postIndex: number) => {
      if (!post || typeof post !== "object" || !post.platform) return;
      const copy = postCopyOf(post);
      rows.push({
        client_id: report.client_id,
        report_id: report.id,
        post_date: date,
        posting_time: post.posting_time ?? null,
        platform: String(post.platform),
        format: post.format ?? null,
        pillar: post.pillar ?? null,
        copy,
        hashtags: Array.isArray(post.hashtags) ? post.hashtags.map(String) : [],
        cta: post.CTA ?? post.cta ?? null,
        visual_direction: post.visual_direction ?? null,
        rationale: post.rationale ?? null,
        language: post.language ?? null,
        reasons: [{ type: "report", label: "Planned from the monthly report", report_id: report.id }],
        source: "report",
        post_key: reportPostKey(report.id, dayIndex, postIndex, day, post),
        raw: post,
      });
    });
  });
  return rows;
}

/**
 * Copy a report's planned posts into the calendar. Safe to run again: posts
 * already there are left as they are. When a report is re-run, the posts of
 * its earlier run that nobody has worked on (no copy edit, design or request
 * attached) are removed, so the calendar does not show both runs.
 */
export async function importReportPosts(admin: any, reportId: string): Promise<{ added: number; removed: number }> {
  const { data: report, error } = await admin.from("reports").select("id, client_id, created_at, report_data").eq("id", reportId).maybeSingle();
  if (error || !report) throw new Error(`Could not read the report: ${error?.message ?? "not found"}`);
  const rows = postsFromReport(report);
  const keys = new Set(rows.map((r) => r.post_key));

  let removed = 0;
  const { data: existing } = await admin.from("calendar_posts").select("id, post_key").eq("report_id", reportId);
  const stale = (existing ?? []).filter((p: { post_key: string }) => !keys.has(p.post_key));
  if (stale.length) {
    const staleKeys = stale.map((p: { post_key: string }) => p.post_key);
    const [{ data: worked }, { data: requested }] = await Promise.all([
      admin.from("post_iterations").select("calendar_post_key").eq("client_id", report.client_id).in("calendar_post_key", staleKeys),
      admin.from("design_requests").select("calendar_post_key").eq("client_id", report.client_id).in("calendar_post_key", staleKeys),
    ]);
    const keep = new Set([...(worked ?? []), ...(requested ?? [])].map((r: { calendar_post_key: string }) => r.calendar_post_key));
    const drop = stale.filter((p: { post_key: string }) => !keep.has(p.post_key)).map((p: { id: string }) => p.id);
    if (drop.length) {
      await admin.from("calendar_posts").delete().in("id", drop);
      removed = drop.length;
    }
  }

  if (!rows.length) return { added: 0, removed };
  const { data, error: insertError } = await admin.from("calendar_posts").upsert(rows, { onConflict: "client_id,post_key", ignoreDuplicates: true }).select("id");
  if (insertError) throw new Error(`Could not add the report's posts to the calendar: ${insertError.message}`);
  return { added: (data ?? []).length, removed };
}
