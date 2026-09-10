// supabase/functions/_shared/reports/payloads.ts
//
// What a report run sends to n8n, built once.
//
// This payload used to be assembled in three places — the monthly run page,
// the competitive run page, and the scheduler — and they had already drifted:
// the pages sent a richer competitive_context than the scheduler, and the two
// sides slugged gap keys differently ("no-repeatable-reels" against "no
// repeatable reels"), so a gap the team endorsed never reached a scheduled
// run. Every run now goes through here: manual, scheduled, and retried.

/**
 * How long a run may sit on "running" before it is treated as dead.
 *
 * A workflow that crashes before its writeback node leaves the row running
 * for ever, and nothing else distinguishes that from a run in progress.
 * Mirrored by STUCK_AFTER_MINUTES in src/lib/reportRun.ts, which decides
 * when the app offers the button; a test asserts the two agree.
 */
export const STUCK_AFTER_MINUTES = 45;

/** True when a row claims to be running but has stopped saying anything. */
export function isStuckRun(status: string | null | undefined, createdAt: string | null | undefined, now = Date.now()): boolean {
  if (status !== "running") return false;
  const started = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(started)) return false;
  return now - started > STUCK_AFTER_MINUTES * 60000;
}

export interface ReportRange {
  start: string;
  end: string;
}

/**
 * Stable key for one suggestion. Must stay identical to insightKey() in
 * src/hooks/useInsightFeedback.ts — the app writes these keys and this reads
 * them back.
 */
export function insightKey(text: string | null | undefined): string {
  const slug = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "untitled";
}

export interface InsightFeedbackRow {
  insight_key: string;
  verdict: string;
  gap_text?: string | null;
}

/**
 * The client's latest competitive analysis, distilled for the content
 * calendar: how they stand, what the field does, which gaps the team has
 * endorsed and which they have rejected.
 */
export function competitiveContext(
  reportRow: { created_at: string; report_data: unknown } | null | undefined,
  feedback: InsightFeedbackRow[] = [],
): Record<string, unknown> | null {
  if (!reportRow?.report_data) return null;
  const rd = reportRow.report_data as any;
  const ai = rd.ai_analysis || {};
  const companies: any[] = rd.aggregates?.companies || [];
  const me = companies.find((c) => c.is_client);
  const rivals = companies.filter((c) => !c.is_client && c.post_count > 0);
  const totalPosts = companies.reduce((sum, c) => sum + (c.post_count || 0), 0);
  const verdict = new Map(feedback.map((r) => [r.insight_key, r.verdict]));
  const gaps: any[] = Array.isArray(ai.gaps_for_client) ? ai.gaps_for_client : [];
  const visible = gaps.filter((g) => verdict.get(insightKey(g.gap)) !== "down");
  const channelSummary = (c: any) =>
    Object.entries(c.by_channel || {}).map(([channel, b]: [string, any]) => ({
      channel,
      post_count: b.post_count,
      cadence_per_week: b.cadence_per_week,
      engagement_rate_avg: b.engagement_rate_avg,
      impressions_avg: b.impressions_avg ?? null,
    }));

  return {
    analyzed_at: reportRow.created_at,
    landscape: rd.landscape?.name || null,
    period: rd.period || null,
    benchmark_score: ai.benchmark_scorecard?.client_score ?? null,
    benchmark_dimensions: (ai.benchmark_scorecard?.dimensions || []).map((d: any) => ({
      dimension: d.dimension,
      client: d.client,
      competitor_avg: d.competitor_avg,
    })),
    share_of_voice_pct: me && totalPosts ? Math.round((me.post_count / totalPosts) * 100) : null,
    client: me
      ? {
          cadence_per_week: me.cadence_per_week,
          engagement_rate_avg: me.engagement_rate_avg,
          channel_mix: me.channel_mix,
          by_channel: channelSummary(me),
        }
      : null,
    competitors: rivals.map((c) => ({
      name: c.name,
      cadence_per_week: c.cadence_per_week,
      engagement_rate_avg: c.engagement_rate_avg,
      channel_mix: c.channel_mix,
      by_channel: channelSummary(c),
      top_hashtags: (c.top_hashtags || []).slice(0, 5).map((h: any) => h.key),
    })),
    executive_summary: ai.executive_summary || null,
    gaps: visible.map((g) => ({
      gap: g.gap,
      platform: g.platform || "all",
      suggested_play: g.suggested_play,
      endorsed: verdict.get(insightKey(g.gap)) === "up",
    })),
    endorsed_gaps: feedback.filter((r) => r.verdict === "up").map((r) => r.gap_text || r.insight_key),
    suppressed_gaps: feedback.filter((r) => r.verdict === "down").map((r) => r.gap_text || r.insight_key),
    winner_patterns: (ai.winner_teardown || []).map((w: any) => ({
      competitor: w.competitor,
      pattern: w.pattern,
      example_post_urls: w.example_post_urls || [],
    })),
    posting_time: ai.posting_time_insights || null,
    recommended_schedule: ai.recommended_schedule || null,
  };
}

/** The brand voice is stored as a [VOICE:x] prefix on the notes. */
export function splitBrandVoice(brandNotes: string | null | undefined): { voice: string; notes: string } {
  const notes = String(brandNotes || "");
  const match = notes.match(/^\[VOICE:(.+?)]\n?/);
  return match ? { voice: match[1], notes: notes.slice(match[0].length) } : { voice: "", notes };
}

const splitList = (value: string | null | undefined, fallback: string[]): string[] =>
  value ? value.split(",").map((s) => s.trim()).filter(Boolean) : fallback;

/** The monthly performance run. */
export async function buildSocialPayload(args: {
  supabase: any;
  client: any;
  reportId: string;
  range: ReportRange;
  skipTrends?: boolean;
  scheduled?: boolean;
  staggerSeconds?: number;
}): Promise<Record<string, unknown>> {
  const { supabase, client, reportId, range } = args;
  const { data: profiles } = await supabase
    .from("sprout_profiles")
    .select("*")
    .eq("client_id", client.id)
    .neq("is_active", false);
  const { data: latestCompetitive } = await supabase
    .from("competitive_reports")
    .select("id, created_at, report_data")
    .eq("client_id", client.id)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: feedback } = await supabase
    .from("competitive_insight_feedback")
    .select("insight_key, verdict, gap_text")
    .eq("client_id", client.id);

  const { voice, notes } = splitBrandVoice(client.brand_notes);
  return {
    report_id: reportId,
    client_name: client.name,
    sprout_customer_id: client.sprout_customer_id || "1676448",
    profile_ids: (profiles || []).map((p: any) => p.sprout_profile_id),
    profiles: (profiles || []).map((p: any) => ({
      id: p.sprout_profile_id,
      name: p.profile_name,
      native_name: p.native_name,
      network: p.network_type,
      url: p.native_link,
    })),
    social_keywords: client.social_keywords || [],
    trends_keywords: client.trends_keywords || "",
    content_pillars: client.content_pillars || [],
    primary_platforms: (client.primary_platforms || []).join(","),
    geo: splitList(client.geo, ["US"]),
    languages: splitList(client.language, ["en"]),
    brand_voice: voice,
    brand_notes: notes,
    brand_book_text: client.brand_book_text || "",
    brief_text: client.brief_text || "",
    brief_file_id: client.brief_file_id || "",
    design_style_synthesis: client.design_style_synthesis || null,
    design_references: client.design_references || [],
    brand_book_file_path: client.brand_book_file_path || null,
    date_range_start: range.start || "",
    date_range_end: range.end || "",
    skip_trends: args.skipTrends === true,
    timezone: client.timezone || "UTC",
    competitive_context: competitiveContext(latestCompetitive, (feedback || []) as InsightFeedbackRow[]),
    ...(args.scheduled ? { scheduled: true } : {}),
    ...(args.staggerSeconds ? { stagger_seconds: args.staggerSeconds } : {}),
  };
}

/** The RivalIQ competitive run. */
export async function buildCompetitivePayload(args: {
  supabase: any;
  client: any;
  reportId: string;
  set: any;
  range: ReportRange;
  scheduled?: boolean;
  staggerSeconds?: number;
}): Promise<Record<string, unknown>> {
  const { supabase, client, reportId, set, range } = args;
  const { data: comps } = await supabase
    .from("competitors")
    .select("*, competitor_handles(*)")
    .eq("set_id", set.id)
    .eq("is_selected", true)
    .order("selected_rank");
  const { data: down } = await supabase
    .from("competitive_insight_feedback")
    .select("gap_text, insight_key")
    .eq("client_id", client.id)
    .eq("verdict", "down");

  return {
    report_id: reportId,
    client_id: client.id,
    client_name: client.name,
    company_slug: client.company_slug,
    website_url: client.website_url,
    set_id: set.id,
    rivaliq_landscape_id: set.rivaliq_landscape_id || undefined,
    date_range_start: range.start,
    date_range_end: range.end,
    suppressed_insights: (down || []).map((f: any) => f.gap_text || f.insight_key).filter(Boolean),
    competitors: (comps || []).map((c: any) => ({
      id: c.id,
      rank: c.selected_rank,
      name: c.name,
      website_url: c.website_url,
      rivaliq_company_id: c.rivaliq_company_id,
      handles: (c.competitor_handles || [])
        .filter((h: any) => h.is_active)
        .map((h: any) => ({ platform: h.platform, handle: h.handle, url: h.profile_url })),
    })),
    ...(args.scheduled ? { scheduled: true } : {}),
    ...(args.staggerSeconds ? { stagger_seconds: args.staggerSeconds } : {}),
  };
}
