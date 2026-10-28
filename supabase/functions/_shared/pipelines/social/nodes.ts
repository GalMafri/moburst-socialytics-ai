// The social report workflow's nodes, ported from n8n "Socialytics - AI
// Social Media Trend Analysis + Insights Agent" (SZbRTV7yOdXTNHHf, live
// version 5f8d3abc; mirrored in n8n/social-workflow.json). One function per
// node, given what the node read through $() and $input, returning what the
// node returned. social/n8nParity.test.ts runs each next to the node's own
// code on the inputs n8n read in two real runs, and both must give what n8n
// gave.
//
// Differences from n8n, each deliberate:
//   * Dates are calendar arithmetic on the period's days. n8n's Set node does
//     the same (Luxon); its Code nodes use the server's clock, which gives the
//     same days except when a period runs across a daylight-saving change.
//   * The brief comes as text. The app has not sent a Drive file since 19 Oct
//     2026, so no node here reads Drive.
//   * Format Report Content is not ported: nothing n8n stores or sends reads
//     its output (Build Presentation Content and Generate Run Summary leave it
//     unread), and parity tests show the deck and the report without it.
//   * The deck prompt (buildPresentationContent) has no em or en dashes, no
//     weekly calendar slides (the analysis has written no calendar since 19 Oct
//     2026), and states no false lines: the post counts behind a fall in
//     reach, a fall only when impressions fell, an underrepresented pillar
//     only when there is one. DECK_EDITS lists every change in the text.
//   * The run summary's start time and duration are the run's own; n8n's
//     summary node used its own finish time as the start.

// deno-lint-ignore no-explicit-any
type Any = any;

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayMs = (day: unknown) => Date.parse(`${String(day).slice(0, 10)}T00:00:00.000Z`);

/** The zone n8n's $now reads (the instance's, Israel). Only the fallbacks for a request without a period use it. */
export const N8N_TIMEZONE = "Asia/Jerusalem";

/** The calendar day in a zone. */
export function zonedDay(now: Date, timeZone = N8N_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ── Workflow Configuration ─────────────────────────────────────────────────

/** The Set node: the request (as body) and the periods, as strings. */
export function workflowConfiguration(request: Any, now: Date): Any {
  const body = request && typeof request === "object" ? request : {};
  const s = body.date_range_start;
  const e = body.date_range_end;
  const today = zonedDay(now);
  const [y, m] = today.split("-").map(Number);
  let previousStart: string;
  let previousEnd: string;
  if (s && e) {
    const days = Math.max(1, Math.round((dayMs(e) - dayMs(s)) / DAY) + 1);
    previousStart = isoDay(dayMs(s) - days * DAY);
    previousEnd = isoDay(dayMs(s) - DAY);
  } else {
    previousStart = isoDay(Date.UTC(y, m - 2, 1));
    previousEnd = isoDay(Date.UTC(y, m - 1, 0));
  }
  return {
    body,
    current_month_start: String(s || `${today.slice(0, 8)}01`),
    current_month_end: String(e || today),
    previous_month_start: previousStart,
    previous_month_end: previousEnd,
    trends_start_date: isoDay(dayMs(today) - 8 * DAY),
    trends_end_date: isoDay(dayMs(today) - DAY),
    client_name: String(body.client_name || ""),
    report_id: String(body.report_id || ""),
    date_range_start: String(body.date_range_start || ""),
    date_range_end: String(body.date_range_end || ""),
  };
}

// ── Prepare Brief Text ─────────────────────────────────────────────────────

/** The brief's text: a read file's text when there is one (none since 19 Oct 2026), else the brief saved in client setup. */
export function prepareBriefText(config: Any, file: { text?: unknown } = {}): Any {
  const body = config.body || config;
  const fallback = String(body.brief_text || config.brief_text || "").trim();
  const hasFile = !!(body.brief_file_id || config.brief_file_id);
  const text = typeof file.text === "string" ? file.text.trim() : "";
  const warning = hasFile && !text ? "The linked brief could not be read. Use a Google Doc, text file or text-based PDF, or paste the brief into client setup." : "";
  return {
    brief_text: text || fallback,
    brief_source: text ? "file" : fallback ? "client_setup" : "none",
    brief_warning: warning ? warning + (fallback ? " The saved brief text was used instead." : " This analysis has no text from that brief.") : "",
  };
}

// ── Combine Brief Context with Client Data ─────────────────────────────────

const BRIEF_KEYS = ["brand_voice", "target_audience", "content_themes", "brand_values", "competitive_positioning", "content_restrictions", "campaign_objectives"];

/**
 * The client, the periods and the brief context. briefAnalysis is what the
 * brief analysis answered ({ output } or { error }), or Prepare Brief Text's
 * output when there was no brief to analyze.
 */
export function combineBrief(briefAnalysisIn: Any, config: Any, prepared: Any): Any {
  const briefAnalysis = briefAnalysisIn || {};
  let clientData: Any = {};
  const wfBody = config.body || config;
  const wfClientName = config.client_name || wfBody.client_name;
  if (config && wfClientName) {
    clientData = { ...wfBody, ...config };
    clientData.client_name = wfClientName;
    const currentStart = wfBody.date_range_start || clientData.date_range_start || clientData.current_month_start;
    const currentEnd = wfBody.date_range_end || clientData.date_range_end || clientData.current_month_end;
    if (currentStart && currentEnd) {
      clientData.current_month_start = currentStart;
      clientData.current_month_end = currentEnd;
      const daysDiff = Math.ceil((dayMs(currentEnd) - dayMs(currentStart)) / DAY);
      const previousEnd = dayMs(currentStart) - DAY;
      clientData.previous_month_start = isoDay(previousEnd - daysDiff * DAY);
      clientData.previous_month_end = isoDay(previousEnd);
    }
  }
  clientData.brief_text = prepared?.brief_text || clientData.brief_text || "";
  const cfg = clientData;

  const contentPillarsRaw = clientData.content_pillars || "";
  let contentPillars: string[] = [];
  if (Array.isArray(contentPillarsRaw)) {
    contentPillars = contentPillarsRaw.map((p: Any) => (typeof p === "string" ? p : p && typeof p === "object" && p.name ? p.name : "")).filter(Boolean);
  } else if (typeof contentPillarsRaw === "string" && contentPillarsRaw.trim()) {
    contentPillars = contentPillarsRaw.split(",").map((p) => p.trim()).filter(Boolean);
  }
  let contentPillarsFull: Any[] = [];
  if (Array.isArray(clientData.content_pillars)) {
    contentPillarsFull = clientData.content_pillars.map((p: Any) => {
      if (typeof p === "string") return { name: p, description: "" };
      if (p && typeof p === "object") return { name: p.name || "", description: p.description || "" };
      return null;
    }).filter(Boolean);
  }

  const socialKeywordsRaw = clientData.social_keywords || "";
  const socialKeywords = Array.isArray(socialKeywordsRaw)
    ? socialKeywordsRaw
    : typeof socialKeywordsRaw === "string" ? socialKeywordsRaw.split(",").map((k) => k.trim()).filter(Boolean) : [];
  const trendsKeywordsRaw = clientData.trends_keywords || "";
  const trendsKeywords = typeof trendsKeywordsRaw === "string" ? trendsKeywordsRaw.trim() : Array.isArray(trendsKeywordsRaw) ? trendsKeywordsRaw.join(", ") : "";

  let profileIds = clientData.profile_ids || [];
  if (typeof profileIds === "string") profileIds = profileIds.split(",").map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id));
  const profiles = clientData.profiles || [];

  let geoArr = clientData.geo || ["US"];
  if (typeof geoArr === "string") geoArr = geoArr.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!Array.isArray(geoArr)) geoArr = [geoArr];
  if (geoArr.length === 0) geoArr = ["US"];

  let languagesArr = clientData.languages || clientData.language || ["en"];
  if (typeof languagesArr === "string") languagesArr = languagesArr.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!Array.isArray(languagesArr)) languagesArr = [languagesArr];
  if (languagesArr.length === 0) languagesArr = ["en"];

  const brandVoice = clientData.brand_voice || "";
  const brandBookText = clientData.brand_book_text || "";

  let briefContext: Any = {
    brand_voice: null, target_audience: null, content_themes: [], brand_values: [],
    competitive_positioning: null, content_restrictions: [], campaign_objectives: null,
  };
  const analyzed = briefAnalysis.output || briefAnalysis;
  const hasBriefAnalysis = BRIEF_KEYS.some((key) => (Array.isArray(analyzed[key]) ? analyzed[key].length > 0 : typeof analyzed[key] === "string" && analyzed[key].trim().length > 0));
  const briefWarning = prepared?.brief_warning || (!hasBriefAnalysis && clientData.brief_text ? "The brief could not be summarized; its original text was included in the analysis." : "");
  if (hasBriefAnalysis) {
    briefContext = {
      brand_voice: briefAnalysis.output?.brand_voice || briefAnalysis.brand_voice || null,
      target_audience: briefAnalysis.output?.target_audience || briefAnalysis.target_audience || null,
      content_themes: briefAnalysis.output?.content_themes || briefAnalysis.content_themes || [],
      brand_values: briefAnalysis.output?.brand_values || briefAnalysis.brand_values || [],
      competitive_positioning: briefAnalysis.output?.competitive_positioning || briefAnalysis.competitive_positioning || null,
      content_restrictions: briefAnalysis.output?.content_restrictions || briefAnalysis.content_restrictions || [],
      campaign_objectives: briefAnalysis.output?.campaign_objectives || briefAnalysis.campaign_objectives || null,
    };
  } else if (clientData.brief_text && clientData.brief_text.trim()) {
    briefContext = { ...briefContext, raw_brief: clientData.brief_text };
  }

  return {
    report_id: clientData.report_id || "",
    client_name: clientData.client_name || "",
    sprout_customer_id: clientData.sprout_customer_id || "",
    profile_ids: profileIds,
    profiles,
    keywords: clientData.keywords || "",
    social_keywords: socialKeywords,
    trends_keywords: trendsKeywords,
    primary_platforms: clientData.primary_platforms || "Instagram,TikTok,Facebook",
    geo: geoArr,
    languages: languagesArr,
    timezone: clientData.timezone || "UTC",
    brand_voice: brandVoice,
    brand_book_text: brandBookText,
    brand_notes: clientData.brand_notes || "",
    brief_file_id: clientData.brief_file_id || "",
    brief_text: clientData.brief_text || "",
    content_pillars: contentPillars,
    content_pillars_full: contentPillarsFull,
    date_ranges: {
      current_month: { start: cfg.current_month_start, end: cfg.current_month_end },
      previous_month: { start: cfg.previous_month_start, end: cfg.previous_month_end },
    },
    skip_trends: !!clientData.skip_trends,
    brief_context: briefContext,
    brief_warning: briefWarning,
    design_style_synthesis: clientData.design_style_synthesis || null,
    design_references: clientData.design_references || [],
    brand_book_file_path: clientData.brand_book_file_path || null,
  };
}

// ── Code in JavaScript (the Sprout setup) ──────────────────────────────────

/** The profiles and periods the Sprout reads use. customerId is the account every client's profiles live under. */
export function sproutSetup(combined: Any, config: Any, customerId: string): Any {
  const clientData: Any = combined?.client_name ? combined : config?.client_name ? config : (config?.body?.client_name ? config.body : {});
  let profileIds = clientData.profile_ids || [];
  if (typeof profileIds === "string") profileIds = profileIds.split(",").map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id));
  profileIds = profileIds.map((id: Any) => (typeof id === "number" ? id : parseInt(id, 10))).filter((id: number) => !isNaN(id));
  if (profileIds.length === 0) {
    const fallback = clientData.sprout_profile_ids || "";
    if (typeof fallback === "string" && fallback.trim()) profileIds = fallback.split(",").map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id));
  }
  const profiles = clientData.profiles || [];
  let currentStart: string, currentEnd: string, previousStart: string, previousEnd: string;
  if (clientData.date_ranges && clientData.date_ranges.current_month) {
    currentStart = clientData.date_ranges.current_month.start;
    currentEnd = clientData.date_ranges.current_month.end;
    previousStart = clientData.date_ranges.previous_month.start;
    previousEnd = clientData.date_ranges.previous_month.end;
  } else {
    currentStart = clientData.current_month_start;
    currentEnd = clientData.current_month_end;
    previousStart = clientData.previous_month_start;
    previousEnd = clientData.previous_month_end;
  }
  return {
    profile_ids: profileIds,
    profiles,
    sprout_customer_id: customerId,
    client_name: clientData.client_name || "",
    report_id: clientData.report_id || "",
    current_month_start: currentStart,
    current_month_end: currentEnd,
    previous_month_start: previousStart,
    previous_month_end: previousEnd,
  };
}

/** Has Sprout Profiles. */
export const hasSproutProfiles = (setup: Any) => Array.isArray(setup?.profile_ids) && setup.profile_ids.length > 0;

/** Skip Sprout Analytics: the aggregate's shape with nothing in it, for a brand with no Sprout profile. */
export function skipSproutAnalytics(setup: Any): Any {
  return {
    profiles: [],
    platform_metrics: {},
    platform_breakdown: [],
    overall_totals: {},
    metric_scope: "reporting_period",
    top_post_metric_scope: "lifetime",
    top_posts: [],
    top_posts_by_platform: {},
    reporting_period: {
      current_month: { start: setup.current_month_start || "", end: setup.current_month_end || "" },
      previous_month: { start: setup.previous_month_start || "", end: setup.previous_month_end || "" },
    },
    month_comparison: {},
    _empty: true,
    _skipped: true,
    reason: "no_sprout_profiles",
    performance_note: "No Sprout Social profile is connected for this brand yet, so there is no performance data in this report. Performance sections fill in once the brand's social accounts are connected.",
  };
}

// ── Aggregate Sprout Social Data ───────────────────────────────────────────

/** The four Sprout reads, each as the pages it answered (one page body per item, as n8n's pagination gives them). */
export interface SproutPages {
  current: Any[];
  previous: Any[];
  posts: Any[];
  previous_posts: Any[];
}

const NETWORK_TO_DISPLAY: Record<string, string> = {
  twitter: "Twitter/X", facebook: "Facebook", instagram: "Instagram",
  fb_instagram_account: "Instagram", linkedin: "LinkedIn",
  linkedin_company: "LinkedIn", tiktok: "TikTok", youtube: "YouTube",
  pinterest: "Pinterest", threads: "Threads",
};
export function displayNetwork(s: unknown): string {
  if (!s) return "Unknown";
  return NETWORK_TO_DISPLAY[String(s).toLowerCase()] || String(s);
}

/** A metric by its flat key or a dotted path; 0 when absent. */
function getMetric(metricsObj: Any, ...keys: string[]): number {
  if (!metricsObj) return 0;
  for (const key of keys) {
    const flatVal = metricsObj[key];
    if (flatVal !== undefined && flatVal !== null) return Number(flatVal) || 0;
    if (key.includes(".")) {
      let current: Any = metricsObj;
      for (const part of key.split(".")) {
        if (current && typeof current === "object") current = current[part];
        else { current = undefined; break; }
      }
      if (current !== undefined && current !== null) return Number(current) || 0;
    }
  }
  return 0;
}

const METRIC_KEYS = ["impressions", "reactions", "link_clicks", "video_views", "comments", "shares", "engagements"] as const;

/** Rounded to a tenth of a percent; null when the previous period was zero and this one is not. */
export function calcChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** The period totals, per platform and overall, the month-over-month changes, and the top posts. Throws on an incomplete or out-of-period answer. */
export function aggregateSprout(a: { pages: SproutPages; combined: Any; config: Any; setup: Any }): Any {
  let config: Any = {};
  const cbc = a.combined;
  if (cbc && cbc.date_ranges) {
    config = {
      current_month_start: cbc.date_ranges.current_month?.start || "",
      current_month_end: cbc.date_ranges.current_month?.end || "",
      previous_month_start: cbc.date_ranges.previous_month?.start || "",
      previous_month_end: cbc.date_ranges.previous_month?.end || "",
    };
  }
  if (!config.current_month_start) config = { ...a.config };
  const profileMetadata: Any[] = a.setup?.profiles || [];

  const readRows = (name: string, pages: Any[], start: string, end: string, posts = false): Any[] => {
    const rows: Any[] = [];
    const seen = new Set<string>();
    let expectedPages = 1;
    for (const response of pages ?? []) {
      if (response?.error || !Array.isArray(response?.data)) throw new Error(name + ": no valid analytics response");
      expectedPages = Math.max(expectedPages, Number(response.paging?.total_pages || 1));
      for (const row of response.data) {
        const dims = row.dimensions || {};
        const field = Object.keys(dims).find((key) => key.startsWith("reporting_period"));
        const date = posts ? String(row.created_time || "").slice(0, 10) : String(dims[field as string] || "").slice(0, 10);
        if (!posts && (!date || date < start || date > end)) throw new Error(name + ": returned a date outside the requested reporting period");
        const key = posts ? (row.guid || row.perma_link || JSON.stringify([dims.customer_profile_id, row.created_time, row.text])) : String(dims.customer_profile_id) + ":" + date;
        if (!seen.has(key)) { seen.add(key); rows.push(row); }
      }
    }
    if ((pages ?? []).length < expectedPages) throw new Error(name + ": not all API pages were retrieved");
    return rows;
  };
  const currentMonthData = readRows("Get Sprout Social Analytics Data", a.pages.current, config.current_month_start, config.current_month_end);
  const previousMonthData = readRows("Get Previous Month Sprout Analytics", a.pages.previous, config.previous_month_start, config.previous_month_end);
  const postAnalyticsData = readRows("Get Sprout Social Post Analytics", a.pages.posts, config.current_month_start, config.current_month_end, true);
  const prevPostAnalyticsData = readRows("Get Previous Month Post Analytics", a.pages.previous_posts, config.previous_month_start, config.previous_month_end, true);

  const profileIdToNetwork: Record<string, string> = {};
  for (const p of profileMetadata) {
    const pid = String(p.id || p.customer_profile_id || "");
    if (pid) profileIdToNetwork[pid] = displayNetwork(p.network || p.network_type || "");
  }
  for (const post of postAnalyticsData.concat(prevPostAnalyticsData)) {
    const pid = String((post.dimensions || {}).customer_profile_id || post.customer_profile_id || "");
    const net = post.network_type || post.network || "";
    if (pid && net && !profileIdToNetwork[pid]) profileIdToNetwork[pid] = displayNetwork(net);
  }
  const networkOf = (item: Any) => profileIdToNetwork[String(item.dimensions?.customer_profile_id || item.customer_profile_id || "")];

  const extractProfileMetrics = (metrics: Any, network: string | undefined) => {
    const reactions = getMetric(metrics, "reactions", "likes");
    const comments = getMetric(metrics, "comments_count", "comments");
    const shares = getMetric(metrics, "shares_count", "shares");
    const engagements = network === "Instagram"
      ? getMetric(metrics, "likes", "reactions") + comments + shares + getMetric(metrics, "saves") + getMetric(metrics, "story_replies")
      : network === "LinkedIn"
      ? reactions + comments + shares + getMetric(metrics, "post_content_clicks", "post_link_clicks")
      : reactions + comments + shares + getMetric(metrics, "post_link_clicks") + getMetric(metrics, "post_content_clicks_other");
    return {
      engagements,
      impressions: getMetric(metrics, "impressions", "lifetime.impressions"),
      reactions: getMetric(metrics, "reactions", "lifetime.reactions", "likes"),
      link_clicks: getMetric(metrics, "post_link_clicks", "lifetime.post_link_clicks", "link_clicks", "clicks"),
      video_views: getMetric(metrics, "video_views", "lifetime.video_views"),
      comments: getMetric(metrics, "comments_count", "comments"),
      shares: getMetric(metrics, "shares_count", "shares"),
    } as Record<(typeof METRIC_KEYS)[number], number>;
  };

  const aggregateMetrics = (dataArray: Any[]) => {
    const totals = Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as Record<string, number>;
    for (const item of dataArray) {
      const m = extractProfileMetrics(item.metrics || item || {}, networkOf(item));
      for (const k of METRIC_KEYS) totals[k] += m[k];
    }
    return totals;
  };
  const currentTotals = aggregateMetrics(currentMonthData);
  const previousTotals = aggregateMetrics(previousMonthData);

  const buildPlatformMetrics = (profileRecords: Any[], postRecords: Any[]) => {
    const pm: Record<string, Any> = {};
    const ensure = (dn: string) => {
      if (!pm[dn]) pm[dn] = { impressions: 0, reactions: 0, link_clicks: 0, video_views: 0, comments: 0, shares: 0, engagements: 0, post_count: 0, profile_names: [], profile_ids: [] };
      return pm[dn];
    };
    for (const p of profileMetadata) {
      const entry = ensure(displayNetwork(p.network || p.network_type || ""));
      const nm = p.native_name || p.name || "";
      const pid = p.id || p.customer_profile_id || "";
      if (nm && !entry.profile_names.includes(nm)) entry.profile_names.push(nm);
      if (pid !== "" && pid !== undefined && pid !== null && !entry.profile_ids.includes(pid)) entry.profile_ids.push(pid);
    }
    for (const item of profileRecords) {
      const dn = networkOf(item) || null;
      if (!dn) continue;
      const entry = ensure(dn);
      const m = extractProfileMetrics(item.metrics || item || {}, networkOf(item));
      entry.impressions += m.impressions;
      entry.reactions += m.reactions;
      entry.link_clicks += m.link_clicks;
      entry.video_views += m.video_views;
      entry.engagements += m.engagements;
      entry.post_count += getMetric(item.metrics, "posts_sent_count");
      entry.comments += m.comments;
      entry.shares += m.shares;
    }
    // A network seen only in the posts still gets its (empty) platform entry, as in n8n.
    for (const post of postRecords) {
      const pid = String((post.dimensions || {}).customer_profile_id || post.customer_profile_id || "");
      const netFromPost = post.network_type || post.network || "";
      const dn = netFromPost ? displayNetwork(netFromPost) : (profileIdToNetwork[pid] || null);
      if (!dn) continue;
      ensure(dn);
    }
    return pm;
  };
  const currentPlatform = buildPlatformMetrics(currentMonthData, postAnalyticsData);
  const previousPlatform = buildPlatformMetrics(previousMonthData, prevPostAnalyticsData);

  const platformMetrics: Record<string, Any> = {};
  for (const dn of Object.keys(currentPlatform)) {
    const e = currentPlatform[dn];
    platformMetrics[dn] = {
      impressions: e.impressions, reactions: e.reactions, link_clicks: e.link_clicks,
      video_views: e.video_views, comments: e.comments, shares: e.shares, engagements: e.engagements,
      post_count: e.post_count,
      profile_name: (e.profile_names || [])[0] || "",
      profile_id: (e.profile_ids || [])[0] || "",
      profile_names: e.profile_names || [],
      profile_ids: e.profile_ids || [],
    };
  }

  const pick = (o: Any) => {
    const out: Record<string, number> = {};
    for (const k of METRIC_KEYS) out[k] = (o && o[k]) || 0;
    return out;
  };
  const allNetworks = new Set([...Object.keys(currentPlatform), ...Object.keys(previousPlatform)]);
  const platformBreakdown: Any[] = [];
  for (const dn of allNetworks) {
    if (dn === "Unknown") continue;
    const cur = currentPlatform[dn] || {};
    const prev = previousPlatform[dn] || {};
    const changes: Record<string, Any> = {};
    for (const metric of METRIC_KEYS) {
      const c = cur[metric] || 0;
      const p = prev[metric] || 0;
      changes[metric] = { current: c, previous: p, absolute: c - p, percent: calcChange(c, p) };
    }
    platformBreakdown.push({
      network: dn,
      profile_names: cur.profile_names && cur.profile_names.length ? cur.profile_names : (prev.profile_names || []),
      profile_ids: cur.profile_ids && cur.profile_ids.length ? cur.profile_ids : (prev.profile_ids || []),
      current: pick(cur),
      previous: pick(prev),
      changes,
      post_count: cur.post_count || 0,
      previous_post_count: prev.post_count || 0,
      has_previous: Object.keys(prev).length > 0 && previousMonthData.length > 0,
    });
  }
  platformBreakdown.sort((x, y) => (y.current.impressions || 0) - (x.current.impressions || 0));

  const monthComparison: Any = {
    current_month: currentTotals,
    previous_month: previousTotals,
    changes: {},
    summary: [],
    data_quality: { has_previous_month: previousMonthData.length > 0, current_records: currentMonthData.length, previous_records: previousMonthData.length },
  };
  for (const metric of METRIC_KEYS) {
    const current = currentTotals[metric] || 0;
    const previous = previousTotals[metric] || 0;
    const abs = current - previous;
    const pct = calcChange(current, previous);
    monthComparison.changes[metric] = { current, previous, absolute: abs, percent: pct };
    const dir = (pct as number) > 0 ? "↑" : (pct as number) < 0 ? "↓" : "→";
    monthComparison.summary.push(`${metric.replace(/_/g, " ")}: ${pct === null ? "new activity (previous period was zero)" : dir + " " + Math.abs(pct) + "%"} (${abs >= 0 ? "+" : ""}${abs})`);
  }

  const mapPost = (post: Any) => {
    const m = post.metrics || {};
    const impressions = getMetric(m, "lifetime.impressions", "impressions");
    const reactions = getMetric(m, "lifetime.reactions", "reactions", "likes");
    const comments = getMetric(m, "lifetime.comments_count", "comments_count", "comments", "lifetime.comments");
    const shares = getMetric(m, "lifetime.shares_count", "shares_count", "shares", "lifetime.shares");
    const linkClicks = getMetric(m, "lifetime.post_link_clicks", "post_link_clicks", "link_clicks");
    const videoViews = getMetric(m, "lifetime.video_views", "video_views");
    const engagements = getMetric(m, "lifetime.engagements", "engagements");
    const likes = getMetric(m, "lifetime.likes", "likes");
    const pid = String((post.dimensions || {}).customer_profile_id || post.customer_profile_id || "");
    const networkFromPost = post.network_type || post.network || "";
    const dn = networkFromPost ? displayNetwork(networkFromPost) : (profileIdToNetwork[pid] || "Unknown");
    return {
      permalink: post.perma_link || post.url || "",
      url: post.perma_link || post.url || "",
      text: post.text || post.caption || post.message || "",
      content: post.text || post.caption || post.message || "",
      network_type: dn.toUpperCase(),
      platform: dn.toUpperCase(),
      platform_display: dn,
      post_type: post.post_type || "",
      content_category: post.content_category || "",
      impressions, reactions, likes, comments, shares,
      link_clicks: linkClicks, video_views: videoViews, engagements,
      engagement: getMetric(m, "lifetime.engagements") || (reactions + comments + shares + linkClicks),
      metric_scope: "lifetime",
      posted_at: post.created_time || "",
    };
  };
  const allMappedPosts = postAnalyticsData.map(mapPost).filter((post) => post.url);
  const topPosts = [...allMappedPosts].sort((x, y) => y.engagement - x.engagement).slice(0, 10);
  const TOP_N_PER_PLATFORM = 5;
  const grouped: Record<string, Any[]> = {};
  for (const post of allMappedPosts) {
    const dn = post.platform_display || "Unknown";
    if (dn === "Unknown") continue;
    (grouped[dn] ??= []).push(post);
  }
  const topPostsByPlatform: Record<string, Any[]> = {};
  for (const dn of Object.keys(grouped)) topPostsByPlatform[dn] = grouped[dn].sort((x, y) => y.engagement - x.engagement).slice(0, TOP_N_PER_PLATFORM);

  return {
    profiles: profileMetadata.map((p) => ({
      id: p.id || p.customer_profile_id,
      name: p.native_name || p.name,
      network: p.network || p.network_type,
      network_display: displayNetwork(p.network || p.network_type || ""),
      url: p.native_link || "",
    })),
    platform_metrics: platformMetrics,
    platform_breakdown: platformBreakdown,
    overall_totals: currentTotals,
    metric_scope: "reporting_period",
    top_post_metric_scope: "lifetime",
    top_posts: topPosts,
    top_posts_by_platform: topPostsByPlatform,
    reporting_period: {
      current_month: { start: config.current_month_start, end: config.current_month_end },
      previous_month: { start: config.previous_month_start, end: config.previous_month_end },
    },
    month_comparison: monthComparison,
  };
}

// ── Attach Post Thumbnails ─────────────────────────────────────────────────

/** Each post with a permalink gets its Sprout thumbnail and media type, joined on the permalink. postPages: both posts reads, as pages. */
export function attachPostThumbnails(aggregate: Any, postPages: Any[]): Any {
  const out = JSON.parse(JSON.stringify(aggregate));
  const byLink = new Map<string, Any>();
  for (const page of postPages) {
    const list = page && Array.isArray(page.data) ? page.data : [];
    for (const p of list) {
      if (!p || typeof p !== "object") continue;
      const link = String(p.perma_link || p.url || "");
      const media = Array.isArray(p.visual_media) ? p.visual_media[0] : null;
      if (link && media && media.thumbnail_url) byLink.set(link, media);
    }
  }
  const stamp = (post: Any) => {
    const m = byLink.get(String(post.permalink || post.url || ""));
    if (!m) return;
    if (!post.thumbnail_url) post.thumbnail_url = m.thumbnail_url;
    if (!post.media_type) post.media_type = m.media_type || "";
  };
  const walk = (v: Any, depth: number) => {
    if (depth > 8 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (v.permalink || v.url) stamp(v);
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
  };
  walk(out, 0);
  return out;
}

// ── Prepare Trend Inputs ───────────────────────────────────────────────────

// The TikTok search runs on apidojo/tiktok-scraper. n8n's scraper,
// clockworks/tiktok-scraper, stopped answering date-filtered video searches
// around 20 Oct 2026 (device registration fails, every search comes back with
// nothing; its open issue "Video search with date filter fails"), and its
// searches without a date filter bring back mostly old, little-seen posts.
// The searches, the date window and the sort are n8n's; only the actor and its
// input's shape differ. n8n's workflow still uses clockworks.

/** TikTok's search date filters, by n8n's searchDatePosted code. */
const TIKTOK_DATE_RANGE: Record<string, string> = { "1": "YESTERDAY", "2": "THIS_WEEK", "3": "THIS_MONTH", "4": "LAST_THREE_MONTHS", "5": "LAST_SIX_MONTHS" };
/** Posts asked for per search, n8n's resultsPerPage. apidojo's maxItems counts across all searches. */
export const TIKTOK_POSTS_PER_SEARCH = 50;

/** The first region that is a country code, for TikTok's search region; none searches everywhere. */
function tiktokLocation(regions: string[]): string | undefined {
  for (const region of regions) {
    const code = region.trim().toUpperCase();
    const iso = code === "UK" ? "GB" : code;
    if (/^[A-Z]{2}$/.test(iso)) return iso;
  }
  return undefined;
}

/** The TikTok and Instagram actor inputs (null when that scraper does not run) and why. */
export function prepareTrendInputs(client: Any): Any {
  const list = (value: Any): string[] => (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [])
    .filter((v: Any) => typeof v === "string").map((v: string) => v.trim()).filter(Boolean);
  const keywords = [...new Set([...list(client.social_keywords), ...list(client.trends_keywords)])].filter((keyword) => /[\p{L}\p{N}]/u.test(keyword));
  const regions = list(client.geo || ["US"]);
  const skipped = client.skip_trends === true;
  const queries = [...new Set([...keywords.slice(0, 5), ...keywords.slice(0, 3).flatMap((keyword) => regions.slice(0, 2).map((region) => keyword + " " + region))])].slice(0, 8);
  // eslint-disable-next-line no-misleading-character-class -- n8n's script ranges, exactly (a range may start on a combining mark).
  const nonLatin = /[\u0590-\u05FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\u0900-\u097F\u0400-\u04FF]/;
  const cleanTag = (value: string) => value.replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
  const baseTags = keywords.flatMap((keyword) => nonLatin.test(keyword) ? keyword.split(/\s+/).map(cleanTag).filter((tag) => tag.length > 1) : [cleanTag(keyword)]).filter(Boolean);
  const regionalTags = keywords.filter((keyword) => !nonLatin.test(keyword)).slice(0, 2)
    .flatMap((keyword) => regions.slice(0, 2).map((region) => cleanTag(keyword + region))).filter(Boolean);
  const hashtags = [...new Set([...baseTags, ...regionalTags])].slice(0, 12);
  let searchDatePosted = "2";
  const start = client.date_ranges?.current_month?.start;
  const end = client.date_ranges?.current_month?.end;
  if (start && end) {
    const days = Math.ceil((Date.parse(end) - Date.parse(start)) / 86400000);
    if (Number.isFinite(days)) searchDatePosted = days <= 1 ? "1" : days <= 7 ? "2" : days <= 30 ? "3" : days <= 90 ? "4" : "5";
  }
  const location = tiktokLocation(regions);
  return {
    ...client,
    trend_status: {
      tiktok: skipped ? "skipped" : queries.length ? "requested" : "missing_keywords",
      instagram: skipped ? "skipped" : hashtags.length ? "requested" : "missing_keywords",
    },
    trend_inputs: {
      // n8n's search, most liked first (its searchSorting "1"), in its date window.
      tiktok: !skipped && queries.length ? {
        keywords: queries, dateRange: TIKTOK_DATE_RANGE[searchDatePosted], sortType: "MOST_LIKED", ...(location ? { location } : {}),
        maxItems: queries.length * TIKTOK_POSTS_PER_SEARCH, includeSearchKeywords: true,
      } : null,
      instagram: !skipped && hashtags.length ? { hashtags, keywordSearch: false, resultsLimit: 80, resultsType: "posts" } : null,
    },
  };
}

// ── Normalize TikTok Trends / Normalize Instagram Trends ───────────────────

const LANG_WORDS: Record<string, string[]> = {
  en: ["the", "and", "for", "you", "this", "that", "with", "have", "are", "was", "will", "your", "from", "how", "what", "when", "get", "can", "all", "just", "not", "but", "more", "like", "new", "business", "marketing", "content", "brand", "social", "media", "digital", "tips", "follow"],
  es: ["que", "los", "las", "del", "por", "una", "con", "para", "como", "pero", "mas", "todo", "esta", "tiene", "hay", "son", "fue", "muy", "tambien", "sobre"],
  fr: ["les", "des", "une", "pour", "dans", "que", "est", "sur", "pas", "plus", "avec", "sont", "tout", "fait", "mais", "comme"],
  de: ["und", "der", "die", "das", "ist", "ein", "fur", "mit", "den", "von", "nicht", "sich", "auf", "dem", "auch", "noch"],
  pt: ["que", "para", "com", "uma", "por", "mais", "como", "mas", "dos", "das", "tem", "sao", "foi", "nao"],
  ar: [], he: [], ja: [], ko: [], zh: [], it: [], ru: [], hi: [], th: [],
};
const SCRIPT_PATTERNS: Record<string, RegExp> = {
  ar: /[\u0600-\u06FF\u0750-\u077F]/,
  he: /[\u0590-\u05FF]/,
  ja: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/,
  ko: /[\uAC00-\uD7AF\u1100-\u11FF]/,
  zh: /[\u4E00-\u9FFF\u3400-\u4DBF]/,
  ru: /[\u0400-\u04FF]/,
  hi: /[\u0900-\u097F]/,
  th: /[\u0E00-\u0E7F]/,
};
function matchesTargetLanguage(text: string, lang: string): boolean {
  if (!text || text.length < 10) return false;
  const cleanText = text.replace(/#\w+/g, "").replace(/@\w+/g, "").replace(/[\u{1F600}-\u{1F6FF}]/gu, "").replace(/[\u{2600}-\u{26FF}]/gu, "").trim();
  if (cleanText.length < 5) return false;
  if (SCRIPT_PATTERNS[lang]) return SCRIPT_PATTERNS[lang].test(cleanText);
  // eslint-disable-next-line no-misleading-character-class -- n8n's script ranges, exactly (a range may start on a combining mark).
  const nonLatinPattern = /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\u0900-\u097F\u0400-\u04FF]/;
  if (nonLatinPattern.test(cleanText)) return false;
  const words = LANG_WORDS[lang] || LANG_WORDS.en;
  if (words.length === 0) return true;
  const lowerText = cleanText.toLowerCase();
  return words.filter((word) => lowerText.includes(word)).length >= 2;
}
const matchesAnyTargetLanguage = (text: string, langs: string[]) => langs.some((lang) => matchesTargetLanguage(text, lang));

const SPAM_SIGNALS = [
  /\b(crypto|bitcoin|btc|ethereum|eth|nft|airdrop|binance|coinbase|token|defi|web3|blockchain|solana|memecoin)\b/i,
  /\b(casino|poker|slots?|betting|bet365|jackpot|roulette)\b/i,
  /\b(f4f|l4l|follow\s*for\s*follow|like\s*for\s*like|follow\s*back|gain\s*followers|free\s*followers)\b/i,
  /\b(onlyfans|18\+|nsfw|xxx|sex|nude|dating\s*site)\b/i,
  /\b(make\s*money\s*fast|passive\s*income\s*\d|earn\s*\$?\d{4,}|work\s*from\s*home\s*\$|financial\s*freedom\s*secret)\b/i,
  /\b(link\s*in\s*bio.*free|dm\s*for\s*price|limited\s*offer|act\s*now)\b/i,
];
function isSpam(caption: string, hashtags: string[]): boolean {
  const fullText = caption + " " + (hashtags || []).join(" ");
  let spamScore = 0;
  for (const pattern of SPAM_SIGNALS) if (pattern.test(fullText)) spamScore++;
  if ((hashtags || []).length > 15 && caption.length < 100) spamScore += 2;
  const emojiCount = (caption.match(/[\u{1F600}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length;
  if (emojiCount > 15) spamScore++;
  return spamScore >= 2;
}

/** What both normalizers read from the client: the target languages, the keywords and the period's first day. */
function trendTargets(clientData: Any) {
  let targetLangs = ["en"];
  const rawLangs = clientData.languages || clientData.language || ["en"];
  targetLangs = Array.isArray(rawLangs)
    ? rawLangs.map((l: string) => l.toLowerCase().slice(0, 2))
    : String(rawLangs).split(",").map((l) => l.trim().toLowerCase().slice(0, 2)).filter(Boolean);
  const socialArr = Array.isArray(clientData.social_keywords) ? clientData.social_keywords : [];
  const trendsRaw = clientData.trends_keywords || "";
  const trendsArr = typeof trendsRaw === "string" ? trendsRaw.split(",").map((k: string) => k.trim()) : Array.isArray(trendsRaw) ? trendsRaw : [];
  const clientKeywords: string[] = [...new Set([...socialArr, ...trendsArr])].filter(Boolean).map((k: string) => k.toLowerCase().replace(/^#/, ""));
  if (targetLangs.length === 0) targetLangs = ["en"];
  return { targetLangs, clientKeywords, trendsStartDate: clientData.date_ranges?.current_month?.start || "" };
}
function relevanceOf(clientKeywords: string[], caption: string, hashtags: string[]): number {
  if (clientKeywords.length === 0) return 1;
  const fullText = (caption + " " + (hashtags || []).join(" ")).toLowerCase();
  let matches = 0;
  for (const kw of clientKeywords) if (fullText.includes(kw) || fullText.includes(kw.replace(/\s+/g, ""))) matches++;
  return matches / Math.max(clientKeywords.length, 1);
}
/** The trend window opens 30 days before the period's first day. */
const passesDate = (trendsStartDate: string, postDate: Date) => !(postDate.getTime() < dayMs(trendsStartDate) - 30 * DAY);
const byRelevanceThenEngagement = (a: Any, b: Any) => {
  const relDiff = b.relevance_score - a.relevance_score;
  if (Math.abs(relDiff) > 0.2) return relDiff;
  return b.engagement_score - a.engagement_score;
};

/**
 * The 15 most relevant TikTok posts in the client's languages, or one empty
 * placeholder. items: the actor's dataset, apidojo's (title, postPage,
 * uploadedAtFormatted, channel) or clockworks' as n8n reads it (a replay of an
 * earlier run keeps clockworks rows). A post found by two searches counts once.
 */
export function normalizeTikTok(items: Any[], clientData: Any): Any[] {
  const { targetLangs, clientKeywords, trendsStartDate } = trendTargets(clientData);
  const seen = new Set<string>();
  const normalized = (items ?? []).map((data: Any) => {
    const likes = data.diggCount || data.likes || 0;
    const comments = data.commentCount || data.comments || 0;
    const shares = data.shareCount || data.shares || 0;
    const views = data.playCount || data.views || 0;
    const engagementScore = likes * 1 + comments * 2 + shares * 3 + Math.floor(views / 1000);
    const caption = data.desc || data.text || data.caption || data.title || "";
    let url = data.webVideoUrl || data.url || data.postPage || "";
    if (!url && data.authorMeta?.name && data.id) url = `https://www.tiktok.com/@${data.authorMeta.name}/video/${data.id}`;
    const author = data.authorMeta?.name || data.author || data.channel?.username || "unknown";
    const hashtags = (data.hashtags || []).map((h: Any) => (typeof h === "string" ? h : h.name || "")).filter(Boolean);
    const textLang = (data.textLanguage || "").toLowerCase();
    const passesLangFilter = targetLangs.includes(textLang) ? true : matchesAnyTargetLanguage(caption, targetLangs);
    const createdIso = data.createTimeISO || data.uploadedAtFormatted || "";
    let passesDateFilter = true;
    if (trendsStartDate && createdIso) passesDateFilter = passesDate(trendsStartDate, new Date(createdIso));
    return {
      source: "tiktok", url, caption, author, hashtags,
      engagement_score: engagementScore,
      views, likes, comments, shares,
      created: createdIso || data.createTime || "",
      matches_language: passesLangFilter,
      is_spam: isSpam(caption, hashtags),
      relevance_score: relevanceOf(clientKeywords, caption, hashtags),
      passes_date: passesDateFilter,
      is_ad: data.isAd || data.isSponsored || false,
    };
  }).filter((item: Any) => {
    if (!item.url || item.url.length < 10) return false;
    if (!item.matches_language) return false;
    if (item.is_ad) return false;
    if (item.is_spam) return false;
    if (!item.passes_date) return false;
    if (clientKeywords.length > 0 && item.relevance_score === 0) return false;
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).sort(byRelevanceThenEngagement).slice(0, 15);
  if (normalized.length === 0) {
    return [{
      source: "tiktok", url: "", caption: `No relevant ${targetLangs.join("/")} TikTok posts found for these keywords`,
      author: "none", hashtags: [], engagement_score: 0, views: 0, likes: 0, comments: 0, shares: 0,
      created: "", matches_language: true, is_ad: false, rank: 0, _empty: true,
    }];
  }
  return normalized.map((item: Any, idx: number) => ({ ...item, rank: idx + 1 }));
}

/** The 15 most relevant Instagram posts in the client's languages, or one empty placeholder. items: the actor's dataset. */
export function normalizeInstagram(items: Any[], clientData: Any): Any[] {
  const { targetLangs, clientKeywords, trendsStartDate } = trendTargets(clientData);
  const normalized = (items ?? []).map((data: Any) => {
    if (data.type === "carousel_item") return null;
    const likes = data.likesCount || data.likes || 0;
    const comments = data.commentsCount || data.comments || 0;
    const views = data.videoViewCount || data.views || 0;
    const safeLikes = likes === -1 ? 0 : likes;
    const engagementScore = safeLikes * 1 + comments * 2 + Math.floor(views / 1000);
    const caption = data.caption || data.text || "";
    let url = data.url || "";
    if (!url && data.shortCode) url = `https://www.instagram.com/p/${data.shortCode}/`;
    const author = data.ownerUsername || data.owner?.username || data.author || "unknown";
    let hashtags: string[] = [];
    if (data.hashtags && Array.isArray(data.hashtags)) hashtags = data.hashtags.map((h: Any) => (typeof h === "string" ? h : h.name || "")).filter(Boolean);
    const postType = data.type || data.__typename || (data.videoUrl ? "Video" : "Image");
    let passesDateFilter = true;
    const postTimestamp = data.timestamp || data.takenAtTimestamp || 0;
    if (trendsStartDate && postTimestamp) {
      passesDateFilter = passesDate(trendsStartDate, typeof postTimestamp === "number" ? new Date(postTimestamp * 1000) : new Date(postTimestamp));
    }
    return {
      source: "instagram", url, caption, author, hashtags,
      engagement_score: engagementScore,
      likes: safeLikes, comments, views,
      type: postType,
      created: data.timestamp || data.takenAtTimestamp || "",
      matches_language: matchesAnyTargetLanguage(caption, targetLangs),
      is_spam: isSpam(caption, hashtags),
      relevance_score: relevanceOf(clientKeywords, caption, hashtags),
      passes_date: passesDateFilter,
    };
  }).filter((item: Any) => {
    if (!item) return false;
    if (!item.url || item.url.length < 10) return false;
    if (!item.matches_language) return false;
    if (item.is_spam) return false;
    if (!item.passes_date) return false;
    if (clientKeywords.length > 0 && item.relevance_score === 0) return false;
    return true;
  }).sort(byRelevanceThenEngagement).slice(0, 15);
  if (normalized.length === 0) {
    return [{
      source: "instagram", url: "", caption: `No relevant ${targetLangs.join("/")} Instagram posts found for these keywords`,
      author: "none", hashtags: [], engagement_score: 0, likes: 0, comments: 0, views: 0,
      type: "none", created: "", matches_language: true, rank: 0, _empty: true,
    }];
  }
  return normalized.map((item: Any, idx: number) => ({ ...item, rank: idx + 1 }));
}

/** Skip TikTok Trends / Skip Instagram Trends: the scraper did not run, and why. */
export const trendSkipped = (source: "tiktok" | "instagram", reason: unknown) => ({ source, _empty: true, _skipped: true, reason });

/** TikTok Trends Failed / Instagram Trends Failed: the scraper ran and failed. */
export function trendFailed(source: "tiktok" | "instagram", error: unknown): Any {
  const e = error as Any;
  const msg = e ? (e.message || e.error || e.description || JSON.stringify(e)) : "unknown error";
  return { source, _empty: true, _skipped: true, reason: "scraper_failed: " + String(msg).slice(0, 300) };
}

// ── Build Normalized Client Object, Attach Competitive Context ─────────────

function trendPatterns(trends: Any[]) {
  const patterns: Any = { common_hashtags: {}, avg_engagement: 0, top_hashtags: [] };
  if (trends.length === 0) return patterns;
  let totalEngagement = 0;
  for (const trend of trends) {
    for (const tag of trend.hashtags || []) {
      const cleanTag = String(tag).toLowerCase().replace(/^#/, "");
      patterns.common_hashtags[cleanTag] = (patterns.common_hashtags[cleanTag] || 0) + 1;
    }
    totalEngagement += trend.engagement_score || 0;
  }
  patterns.avg_engagement = Math.round(totalEngagement / trends.length);
  patterns.top_hashtags = Object.entries(patterns.common_hashtags).sort((a: Any, b: Any) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));
  return patterns;
}

/**
 * Merge All Data Sources (the Sprout item, then the TikTok items, then the
 * Instagram items) and Build Normalized Client Object.
 */
export function buildNormalizedClient(allItems: Any[], config: Any, clientData: Any, now: Date): Any {
  let sproutData: Any = { profiles: [], platform_metrics: {}, platform_breakdown: [], top_posts: [], top_posts_by_platform: {}, overall_totals: {}, reporting_period: {}, month_comparison: {} };
  for (const json of allItems) {
    if (json.profiles !== undefined || json.month_comparison !== undefined || json.overall_totals !== undefined) { sproutData = json; break; }
  }
  const tiktokTrends = allItems.filter((j) => j.source === "tiktok" && !j._empty);
  const instagramTrends = allItems.filter((j) => j.source === "instagram" && !j._empty);
  const clientProfileIds = (clientData.sprout_profile_ids || "").toString().split(",").map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id));
  let clientProfiles = sproutData.profiles || [];
  if (clientProfileIds.length > 0) clientProfiles = clientProfiles.filter((profile: Any) => clientProfileIds.includes(profile.id));

  let geoArr = clientData.geo || ["US"];
  if (typeof geoArr === "string") geoArr = geoArr.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!Array.isArray(geoArr)) geoArr = [geoArr];
  let languagesArr = clientData.languages || clientData.language || ["en"];
  if (typeof languagesArr === "string") languagesArr = languagesArr.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!Array.isArray(languagesArr)) languagesArr = [languagesArr];

  return {
    client_name: clientData.client_name || "Unknown Client",
    report_window: {
      current_month: clientData.date_ranges?.current_month || sproutData.reporting_period?.current_month || { start: config.current_month_start, end: config.current_month_end },
      previous_month: clientData.date_ranges?.previous_month || sproutData.reporting_period?.previous_month || { start: config.previous_month_start, end: config.previous_month_end },
    },
    context: {
      geo: geoArr,
      languages: languagesArr,
      timezone: clientData.timezone || "UTC",
      brand_voice: clientData.brand_voice || "",
      brand_book_text: clientData.brand_book_text || "",
      primary_platforms: typeof clientData.primary_platforms === "string"
        ? clientData.primary_platforms.split(",").map((p: string) => p.trim())
        : clientData.primary_platforms || ["Instagram", "TikTok", "LinkedIn"],
      brand_notes: clientData.brand_notes || "",
      brief_context: clientData.brief_context || {},
      content_pillars: clientData.content_pillars || [],
      design_style_synthesis: clientData.design_style_synthesis || null,
      has_design_references: Array.isArray(clientData.design_references) && clientData.design_references.length > 0,
      has_brand_book: !!clientData.brand_book_file_path,
    },
    skip_trends: !!clientData.skip_trends,
    sprout: {
      profiles: clientProfiles,
      platform_metrics: sproutData.platform_metrics || {},
      overall_totals: sproutData.overall_totals || {},
      top_posts: sproutData.top_posts || [],
      month_comparison: sproutData.month_comparison || {},
      platform_breakdown: sproutData.platform_breakdown || [],
      top_posts_by_platform: sproutData.top_posts_by_platform || {},
    },
    trends: {
      tiktok: { posts: tiktokTrends, patterns: trendPatterns(tiktokTrends) },
      instagram: { posts: instagramTrends, patterns: trendPatterns(instagramTrends) },
    },
    _meta: {
      tiktok_count: tiktokTrends.length,
      instagram_count: instagramTrends.length,
      profiles_count: clientProfiles.length,
      generated_at: now.toISOString(),
    },
  };
}

/** The latest competitive report the request carried, compacted, or null. */
export function attachCompetitiveContext(normalized: Any, config: Any): Any {
  return { ...normalized, competitive_context: config.body?.competitive_context ?? config.competitive_context ?? null };
}

// ── Build Presentation Content ─────────────────────────────────────────────

/**
 * Every change from n8n's deck text, as [n8n's text, the port's text]; the
 * parity test applies them to n8n's output and must get the port's.
 */
export const DECK_EDITS: ReadonlyArray<readonly [RegExp, string]> = [
  [/CRITICAL CONTENT RULES \(follow exactly - do not deviate\):/g, "CRITICAL CONTENT RULES (follow exactly, do not deviate):"],
  [/^▸ (.+) \u2014 (\d+) posts$/gm, "▸ $1: $2 posts"],
  [/grouped bar chart \u2014 one row\/group per platform\./g, "grouped bar chart, one row or group per platform."],
  [/^● (.+) \u2014 TOP POSTS$/gm, "● $1: TOP POSTS"],
  [/\(EXTERNAL ACCOUNTS - NOT /g, "(EXTERNAL ACCOUNTS, NOT "],
  [/^• Sprout Social API - /gm, "• Sprout Social API: "],
  [/^• Sprout Social - not connected/gm, "• Sprout Social: not connected"],
  [/^• TikTok Trend Scraper - /gm, "• TikTok Trend Scraper: "],
  [/^• Instagram Trend Scraper - /gm, "• Instagram Trend Scraper: "],
  [/% - prioritize improvement$/gm, "%, prioritize improvement"],
];

function truncate(text: unknown, maxLen = 200): string {
  if (!text) return "";
  const clean = String(text).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen) + "...";
}
const n = (v: unknown) => Number(v || 0).toLocaleString("en-US");
const longDate = (now: Date) => now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** The Gamma prompt for the deck, and the counts n8n's summary reads from it. ai: the parsed analysis. */
export function buildPresentationContent(clientData: Any, ai: Any, now: Date): Any {
  const aiOutput = ai?.output || ai || {};
  const clientName = clientData.client_name || "Client";
  const date = longDate(now);
  const momComparison = clientData.sprout?.month_comparison || {};
  const changes = momComparison.changes || {};
  const momSummary: string[] = momComparison.summary || [];
  const sproutTopPosts: Any[] = clientData.sprout?.top_posts || [];
  const overallTotals = clientData.sprout?.overall_totals || {};
  const platformBreakdown: Any[] = clientData.sprout?.platform_breakdown || [];
  const topPostsByPlatform = clientData.sprout?.top_posts_by_platform || {};
  const hasSprout = (Array.isArray(clientData.sprout?.profiles) && clientData.sprout.profiles.length > 0) || sproutTopPosts.length > 0 || Object.keys(overallTotals).length > 0;

  let platformBreakdownBlock = "";
  if (Array.isArray(platformBreakdown) && platformBreakdown.length > 0) {
    const pctStr = (ch: Any, k: string) => {
      const v = ch && ch[k] && typeof ch[k].percent === "number" ? ch[k].percent : null;
      if (v === null) return "";
      return " (" + (v > 0 ? "+" : "") + v + "% MoM)";
    };
    let body = "Profile activity within the exact report dates, compared with the preceding equal-length period:\n\n";
    for (const p of platformBreakdown) {
      const c = p.current || {};
      const ch = p.changes || {};
      body += "▸ " + (p.network || "Platform").toUpperCase() + ": " + (p.post_count || 0) + " posts\n";
      body += "   Impressions: " + n(c.impressions) + pctStr(ch, "impressions") + "\n";
      body += "   Reactions: " + n(c.reactions) + pctStr(ch, "reactions") + "   |   Comments: " + n(c.comments) + pctStr(ch, "comments") + "   |   Shares: " + n(c.shares) + pctStr(ch, "shares") + "\n";
      body += "   Link Clicks: " + n(c.link_clicks) + pctStr(ch, "link_clicks") + "   |   Video Views: " + n(c.video_views) + pctStr(ch, "video_views") + "\n\n";
    }
    platformBreakdownBlock = "\n\n---\n\nSLIDE 3B: PLATFORM-BY-PLATFORM PERFORMANCE\n\n" + body + "Visualize as a comparison table or grouped bar chart, one row or group per platform.";
  }

  const tiktokPosts: Any[] = clientData.trends?.tiktok?.posts || [];
  const tiktokPatterns = clientData.trends?.tiktok?.patterns || {};
  const instagramPosts: Any[] = clientData.trends?.instagram?.posts || [];
  const instagramPatterns = clientData.trends?.instagram?.patterns || {};
  const contentPillars: string[] = clientData.context?.content_pillars || [];
  const sproutAnalysis = aiOutput.sprout_performance_analysis || {};
  const tiktokAnalysis = aiOutput.tiktok_trends_analysis || {};
  const igAnalysis = aiOutput.instagram_trends_analysis || {};

  const formatMetrics = (post: Any, platform: string) => platform === "tiktok"
    ? `Views: ${n(post.views)} | Likes: ${n(post.likes)} | Comments: ${n(post.comments)} | Shares: ${n(post.shares)}`
    : `Likes: ${n(post.likes)} | Comments: ${n(post.comments)}`;

  // The fall in reach is said with the post counts that sit behind it (the platform totals carry them).
  const postsNow = platformBreakdown.reduce((s, p) => s + (Number(p.post_count) || 0), 0);
  const postsBefore = platformBreakdown.reduce((s, p) => s + (Number(p.previous_post_count) || 0), 0);
  let keyInsight = "";
  if (changes.impressions?.percent < -50) {
    keyInsight = postsBefore > postsNow
      ? `Significant performance decline across all metrics requires immediate attention. Content volume dropped from ${postsBefore} to ${postsNow} posts, directly impacting reach.`
      : "Significant performance decline across all metrics requires immediate attention.";
  } else if (changes.impressions?.percent > 20) {
    keyInsight = `Strong growth momentum with ${changes.impressions?.percent}% increase in impressions. Top performing content themes should be expanded.`;
  } else {
    keyInsight = sproutAnalysis.month_over_month_summary || "See detailed analysis below.";
  }

  let prompt = `Create a professional Social Media Performance & Trend Analysis Report for ${clientName}.

DESIGN INSTRUCTIONS:
- Visually engaging executive presentation with modern, clean design
- Use charts/graphs for all metrics sections
- Each major section should be its own slide or slide group
- Highlight key numbers, percentages, and quotes prominently
- Include clickable links where URLs are provided
- Use brand colors if known, otherwise professional blue/gray palette

CRITICAL CONTENT RULES (follow exactly, do not deviate):
- This report contains TWO distinct kinds of posts. NEVER mix them:
  1. CLIENT OWN POSTS = posts published by ${clientName}'s OWN social accounts (their own results).
  2. TRENDING INDUSTRY POSTS = external, third-party posts from OTHER accounts, shown only as market/trend reference.
- The slide titled ${clientName}'S OWN TOP PERFORMING POSTS must use ONLY the posts listed in that section. Never replace, supplement, merge, or re-rank them with trending or industry posts.
- Replace any existing sample or placeholder posts in the template with the exact posts provided here; never keep template example posts.
- Reproduce every performance number and date EXACTLY from the supplied tables. Do not recalculate, estimate, or combine lifetime post metrics with period profile totals. Label Facebook/Instagram impressions as views and LinkedIn clicks as all post clicks. Reproduce every post account/handle, metrics, caption text and URL EXACTLY as written. Do not invent, swap, summarize away, or reorder posts. Keep the given order.

---

SLIDE 1: TITLE

${clientName}
Social Performance Report
Reporting period: ${clientData.report_window?.current_month?.start} to ${clientData.report_window?.current_month?.end}
Generated: ${date}

---

SLIDE 2: EXECUTIVE SUMMARY

REPORT PERIOD: ${clientData.report_window?.current_month?.start || "Current Month"} to ${clientData.report_window?.current_month?.end || "Present"}

METRIC SCOPE NOTE (display visibly): Profile totals cover only the report dates. Facebook/Instagram impressions use the provider's views metric. The clicks total includes LinkedIn all-post clicks, not only outbound link clicks. Top-post figures are lifetime metrics and are separate from these period totals.

KEY METRICS AT A GLANCE:
`;
  for (const metric of momSummary) prompt += `• ${metric}\n`;
  prompt += `
⚡ KEY INSIGHT: ${keyInsight}

PLATFORMS ANALYZED: ${clientData.context?.primary_platforms?.join(", ") || "LinkedIn, Instagram, Facebook"}
CONTENT PILLARS: ${contentPillars.slice(0, 4).join(", ") || "See pillar analysis"}
`;
  if (hasSprout) {
    prompt += `
---

SLIDE 3: PERFORMANCE DASHBOARD

MONTH-OVER-MONTH COMPARISON (Visualize as bar chart or gauge):

`;
    for (const [metric, data] of Object.entries(changes) as Array<[string, Any]>) {
      if (data && typeof data.percent === "number") {
        const arrow = data.percent > 0 ? "↑" : data.percent < 0 ? "↓" : "→";
        const emoji = data.percent > 20 ? "🟢" : data.percent > 0 ? "🟡" : data.percent < -20 ? "🔴" : "⚪";
        const change = data.absolute >= 0 ? `+${n(data.absolute)}` : Number(data.absolute).toLocaleString("en-US");
        prompt += `${emoji} ${metric.replace(/_/g, " ").toUpperCase()}: ${arrow} ${Math.abs(data.percent)}% (${change})\n`;
      }
    }
    prompt += `
CURRENT PERIOD TOTALS:
• Total Impressions: ${n(overallTotals.impressions)}
• Total Reactions: ${n(overallTotals.reactions)}
• Period Engagements: ${n(overallTotals.engagements)}
• Period Comments: ${n(overallTotals.comments)}
• Period Shares: ${n(overallTotals.shares)}
• Total Link Clicks: ${n(overallTotals.link_clicks)}
• Total Video Views: ${n(overallTotals.video_views)}${platformBreakdownBlock}

---

SLIDE 4: PERFORMANCE INSIGHTS

KEY FINDINGS:
`;
    (sproutAnalysis.key_insights || ["Analysis pending"]).forEach((insight: string, i: number) => { prompt += `${i + 1}. ${insight}\n\n`; });
  } else {
    prompt += `
---

SLIDE 3: PERFORMANCE DATA

${clientName} has no social accounts connected for performance tracking yet, so this report carries no performance figures. Make this one short slide that says performance tracking starts once the brand's accounts are connected, and that this report is built from trend research, the competitive picture and the content plan. Do not show zeros, KPI tiles or charts here.

`;
  }

  if (hasSprout) {
    prompt += `
---

SLIDE 5: ${clientName}'S OWN TOP PERFORMING POSTS (CLIENT ACCOUNTS)

These are ${clientName}'s OWN best-performing posts from their OWN social accounts this period. Reproduce these EXACT posts, in this EXACT order. Do NOT replace or supplement them with the trending or industry posts shown on later slides:

`;
    const tppKeys = Object.keys(topPostsByPlatform || {});
    if (tppKeys.length > 0) {
      for (const network of tppKeys) {
        const posts: Any[] = topPostsByPlatform[network] || [];
        if (!posts.length) continue;
        prompt += `\n● ${network.toUpperCase()}: TOP POSTS\n`;
        posts.slice(0, 3).forEach((post, i) => {
          const metrics = `Lifetime metrics (not period totals). Impressions: ${n(post.impressions)} | Reactions: ${n(post.reactions)} | Comments: ${n(post.comments)} | Shares: ${n(post.shares)} | Clicks: ${n(post.link_clicks)}`;
          const postText = truncate(post.text || post.message || post.content || "No text available", 250);
          prompt += `\n📌 ${network.toUpperCase()} CLIENT POST ${i + 1}\n${metrics}\n"${postText}"\n${post.permalink || post.url || ""}\n`;
        });
      }
    } else if (sproutTopPosts.length > 0) {
      sproutTopPosts.slice(0, 5).forEach((post, i) => {
        const platform = post.network_type || post.platform || "Social";
        const metrics = `Lifetime metrics (not period totals). Impressions: ${n(post.impressions)} | Reactions: ${n(post.reactions)} | Clicks: ${n(post.link_clicks)}`;
        const postText = truncate(post.text || post.message || post.content || "No text available", 250);
        prompt += `\n📌 CLIENT OWN POST ${i + 1} [${platform.toUpperCase()}]\n${metrics}\n"${postText}"\n${post.permalink || post.url || ""}\n\n`;
      });
    } else {
      prompt += `No top posts data available for this period. This may indicate limited posting activity.\n`;
    }
  }

  prompt += `
---

SLIDE 6: CONTENT PILLAR ANALYSIS

DEFINED PILLARS: ${contentPillars.join(" | ") || "Not specified"}

✅ WELL-REPRESENTED IN CURRENT CONTENT:
`;
  for (const p of sproutAnalysis.pillar_alignment?.well_represented || ["See detailed analysis"]) prompt += `• ${p}\n`;
  prompt += `
⚠️ UNDERREPRESENTED (OPPORTUNITY AREAS):
`;
  for (const p of sproutAnalysis.pillar_alignment?.underrepresented || ["See detailed analysis"]) prompt += `• ${p}\n`;
  prompt += `
💡 PILLAR RECOMMENDATIONS:
`;
  (sproutAnalysis.pillar_alignment?.recommendations || []).slice(0, 3).forEach((rec: string, i: number) => { prompt += `${i + 1}. ${rec}\n`; });

  const hasTikTokData = tiktokPosts.length > 0 || (tiktokAnalysis.overview && tiktokAnalysis.overview !== "No analysis available.");
  const hasInstagramData = instagramPosts.length > 0 || (igAnalysis.overview && igAnalysis.overview !== "No analysis available.");
  const skipTrends = clientData.skip_trends || (!hasTikTokData && !hasInstagramData);
  let slideNum = 7;

  const trendSlides = (o: { label: string; analysis: Any; patterns: Any; posts: Any[]; platform: "tiktok" | "instagram"; formatsIcon: string; postIcon: string }) => {
    prompt += `
---

SLIDE ${slideNum}: ${o.label.toUpperCase()} TRENDS OVERVIEW

${o.analysis.overview || `Analysis of top-performing ${o.label} content in your industry keywords.`}

🔥 TOP THEMES IDENTIFIED:
`;
    for (const theme of o.analysis.top_themes || []) prompt += `• ${theme}\n`;
    prompt += `
${o.formatsIcon} SUCCESSFUL CONTENT FORMATS:
`;
    for (const format of o.analysis.successful_formats || []) prompt += `• ${format}\n`;
    prompt += `
#️⃣ TRENDING HASHTAGS: ${(o.patterns.top_hashtags || []).slice(0, 8).map((h: Any) => `#${h.tag}`).join("  ") || "See individual posts"}

---

SLIDE ${slideNum + 1}: TRENDING ${o.label.toUpperCase()} CONTENT IN YOUR INDUSTRY (EXTERNAL ACCOUNTS, NOT ${clientName}'S POSTS)

These are external, third-party ${o.label} posts from OTHER accounts in your industry, shown for trend reference only. They are NOT ${clientName}'s posts and must never appear on the client's own top-posts slide. Study their hooks and copy:

`;
    o.posts.slice(0, 7).forEach((post, i) => {
      const caption = truncate(post.caption, 300);
      prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${o.postIcon} TRENDING ${o.label.toUpperCase()} #${i + 1} (EXTERNAL ACCOUNT): @${post.author}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENGAGEMENT SCORE: ${post.engagement_score?.toLocaleString("en-US") || "N/A"}
${formatMetrics(post, o.platform)}
${o.platform === "instagram" ? `TYPE: ${post.type || "Post"}\n` : ""}
CAPTION/COPY:
"${caption}"

HASHTAGS: ${(post.hashtags || []).slice(0, 5).map((h: string) => `#${h}`).join(" ") || "None"}

🔗 ${post.url}

`;
    });
    prompt += `
💡 KEY ${o.label.toUpperCase()} TAKEAWAYS:
`;
    (o.analysis.key_takeaways || []).forEach((takeaway: string, i: number) => { prompt += `${i + 1}. ${takeaway}\n`; });
    slideNum += 2;
  };
  if (hasTikTokData) trendSlides({ label: "TikTok", analysis: tiktokAnalysis, patterns: tiktokPatterns, posts: tiktokPosts, platform: "tiktok", formatsIcon: "📹", postIcon: "📱" });
  if (hasInstagramData) trendSlides({ label: "Instagram", analysis: igAnalysis, patterns: instagramPatterns, posts: instagramPosts, platform: "instagram", formatsIcon: "📸", postIcon: "📷" });

  if (skipTrends) {
    prompt += `\n---\n\nSLIDE ${slideNum}: TREND ANALYSIS\n\nTrend analysis was not included in this report. This may be because:\n- No social keywords were configured for this client\n- Trend analysis was explicitly skipped for this run\n\nTo enable trend analysis, add social keywords in the client onboarding screen.\n`;
    slideNum++;
  }

  // Action items: a fall named only when impressions fell, a pillar only when the analysis found one underrepresented.
  const underrepresented = sproutAnalysis.pillar_alignment?.underrepresented?.[0];
  prompt += `
---

SLIDE ${slideNum}: ACTION ITEMS & NEXT STEPS

🚨 IMMEDIATE PRIORITIES (This Week):
• Implement top 3 content recommendations
${changes.impressions?.percent < 0 ? "• Address performance decline with increased posting frequency\n" : ""}${underrepresented ? `• Focus on underrepresented pillar: ${underrepresented}\n` : ""}• Test hooks inspired by top-performing TikTok content

📅 WEEKLY POSTS:
• Each week's posts are planned in the Socialytics calendar the Monday before, from the latest results.

📈 METRICS TO PRIORITIZE:
`;
  for (const [metric, data] of Object.entries(changes) as Array<[string, Any]>) {
    if (data && data.percent < -20) prompt += `• ${metric.replace(/_/g, " ")}: Currently ${data.percent}%, prioritize improvement\n`;
  }
  prompt += `
🎯 SUCCESS CRITERIA FOR NEXT REPORT:
• Increase posting frequency by 50%+
• Achieve engagement rate improvement on key pillars
• Test at least 3 new content formats from trend analysis

---

SLIDE ${slideNum + 2}: DATA SOURCES & METHODOLOGY

📊 DATA SOURCES:
${hasSprout ? "• Sprout Social API: " + sproutTopPosts.length + " top posts analyzed, full performance metrics" : "• Sprout Social: not connected for this brand yet; no performance data in this report"}
• TikTok Trend Scraper: ${tiktokPosts.length} top posts by engagement (filtered by target languages)
• Instagram Trend Scraper: ${instagramPosts.length} top posts by engagement (filtered by target languages)

🔍 METHODOLOGY:
• Engagement Scoring: (likes × 1) + (comments × 2) + (shares × 3) + (views ÷ 1000)
• Language Filter: Target language content for relevance (multi-language supported)
• Performance dates: ${clientData.report_window?.current_month?.start} to ${clientData.report_window?.current_month?.end}. Top-post metrics are lifetime values for posts published in those dates; they are not period totals.
• Hashtags Searched: ${clientData.context?.brief_context?.social_keywords?.join(", ") || "Industry-relevant keywords"}

📅 REPORT GENERATED: ${date}

---

END OF PRESENTATION
`;

  return {
    presentation_content: prompt,
    client_name: clientName,
    report_date: now.toISOString().split("T")[0],
    total_recommendations: 0,
    metrics_summary: {
      impressions_change: changes.impressions?.percent || 0,
      reactions_change: changes.reactions?.percent || 0,
      link_clicks_change: changes.link_clicks?.percent || 0,
      video_views_change: changes.video_views?.percent || 0,
    },
    data_included: {
      sprout_top_posts: sproutTopPosts.length,
      tiktok_posts_with_captions: tiktokPosts.length,
      instagram_posts_with_captions: instagramPosts.length,
      content_pillars: contentPillars.length,
    },
    trends_count: { tiktok: tiktokPosts.length, instagram: instagramPosts.length },
  };
}

// ── Check Gamma State ──────────────────────────────────────────────────────

/** Gamma looks before the deck counts as timed out (20 looks, 30 s apart). */
export const GAMMA_CHECKS = 20;
const GAMMA_PENDING = ["pending", "queued", "processing", "running", "in_progress"];

/** One look at the generation: whether to look again, or it timed out. attempt counts from 1. */
export function checkGammaState(result: Any, attempt: number): Any {
  const state = String(result?.status || result?.data?.status || "").toLowerCase();
  const pending = GAMMA_PENDING.includes(state);
  return { ...result, _gamma_attempt: attempt, _gamma_poll_again: pending && attempt < GAMMA_CHECKS, _gamma_timeout: pending && attempt >= GAMMA_CHECKS };
}

// ── Generate Run Summary ───────────────────────────────────────────────────

function topHashtags(posts: Any[], limit = 10) {
  const tagCounts: Record<string, number> = {};
  for (const post of posts) {
    for (const tag of post.hashtags || []) {
      const clean = String(tag).toLowerCase().replace(/^#/, "");
      if (clean) tagCounts[clean] = (tagCounts[clean] || 0) + 1;
    }
  }
  return Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag, count]) => ({ tag, count }));
}
function avgEngagement(posts: Any[]) {
  if (!posts.length) return 0;
  return Math.round(posts.reduce((sum, p) => sum + (p.engagement_score || 0), 0) / posts.length);
}

export interface SummaryInput {
  /** Check Gamma State's last output, or the failed request's output. */
  gamma: Any;
  presentation: Any;
  clientData: Any;
  combined: Any;
  config: Any;
  /** Aggregate Sprout Social Data's output, or null when it did not run (no profiles). */
  sprout: Any | null;
  /** The parsed analysis. */
  ai: Any;
  prepared: Any;
  trendStatus: Any;
  /** When the run started and now. */
  startedAt: Date;
  now: Date;
}

/** The report_data the writer stores. */
export function generateRunSummary(a: SummaryInput): Any {
  const gammaResult = a.gamma || {};
  const presentationData = a.presentation || {};
  const clientData = a.clientData || {};
  const cbc = a.combined || {};
  const config: Any = {
    current_month_start: cbc.date_ranges?.current_month?.start || "",
    current_month_end: cbc.date_ranges?.current_month?.end || "",
    previous_month_start: cbc.date_ranges?.previous_month?.start || "",
    previous_month_end: cbc.date_ranges?.previous_month?.end || "",
    client_name: cbc.client_name,
    report_id: cbc.report_id,
  };
  const reportId = cbc.report_id || a.config?.report_id || a.config?.body?.report_id || config.report_id || "";
  const sproutData = a.sprout || {};
  const aiAnalysis = a.ai?.output ?? a.ai ?? {};
  const endTime = a.now.toISOString();
  const startTime = a.startedAt.toISOString();
  const durationMins = Math.round((a.now.getTime() - a.startedAt.getTime()) / 60000);

  const candidateUrl = gammaResult.gammaUrl || gammaResult.url || gammaResult.shareUrl || gammaResult.shareLink || gammaResult.share_url || gammaResult.share_link
    || gammaResult.exportUrl || gammaResult.export_url || gammaResult.viewUrl || gammaResult.view_url
    || gammaResult.data?.gammaUrl || gammaResult.data?.url || gammaResult.data?.shareUrl || gammaResult.data?.shareLink
    || gammaResult.result?.url || gammaResult.result?.shareUrl || gammaResult.link || gammaResult.generatedContentUrl
    || gammaResult.data?.link || gammaResult.data?.generatedContentUrl || gammaResult.generation?.url || gammaResult.generation?.shareUrl
    || gammaResult.generation?.link || gammaResult.output?.url || gammaResult.output?.shareUrl || null;
  const gammaState = String(gammaResult.status || gammaResult.data?.status || "").toLowerCase();
  const validUrl = typeof candidateUrl === "string" && /^https:\/\/[^\s]+$/i.test(candidateUrl);
  const gammaSuccess = gammaState === "completed" && validUrl;
  const presentationUrl = gammaSuccess ? candidateUrl : null;
  const isSuccess = !!aiAnalysis && typeof aiAnalysis === "object" && !aiAnalysis.error && ["content_calendar", "sprout_performance_analysis", "executive_summary"].some((key) => aiAnalysis[key] != null);

  const warnings: string[] = [];
  if (!gammaSuccess) {
    warnings.push(gammaResult._gamma_timeout
      ? "The analysis is available, but presentation generation timed out. No presentation link is available."
      : "The analysis is available, but the presentation did not complete. No presentation link is available.");
  }
  if (a.prepared?.brief_warning) warnings.push(a.prepared.brief_warning);
  if (cbc.brief_warning && !warnings.includes(cbc.brief_warning)) warnings.push(cbc.brief_warning);

  const tiktokTrends: Any[] = clientData.trends?.tiktok?.posts || clientData.tiktok_trends || [];
  const instagramTrends: Any[] = clientData.trends?.instagram?.posts || clientData.instagram_trends || [];

  let geoArr = clientData.context?.geo || config.geo || ["US"];
  if (typeof geoArr === "string") geoArr = geoArr.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!Array.isArray(geoArr)) geoArr = [geoArr];
  let languagesArr = clientData.context?.languages || clientData.context?.language || config.languages || config.language || ["en"];
  if (typeof languagesArr === "string") languagesArr = languagesArr.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!Array.isArray(languagesArr)) languagesArr = [languagesArr];

  const trendStatus = a.trendStatus || {};
  for (const [platform, state] of Object.entries(trendStatus)) {
    if (state === "missing_keywords") warnings.push(`${platform === "tiktok" ? "TikTok" : "Instagram"} trend analysis could not run because there were no usable keywords. Add keywords in client setup.`);
  }
  const calendar: Any[] = aiAnalysis.content_calendar || [];
  return {
    report_id: reportId,
    status: isSuccess ? "success" : "failed",
    client_name: presentationData.client_name || clientData.client_name || config.client_name || "Unknown",
    report_date: a.now.toISOString().split("T")[0],
    started_at: startTime,
    completed_at: endTime,
    duration_minutes: durationMins,
    report_period: {
      current_month: { start: String(config.current_month_start || "").trim(), end: String(config.current_month_end || "").trim() },
      previous_month: { start: String(config.previous_month_start || "").trim(), end: String(config.previous_month_end || "").trim() },
    },
    sprout_performance: {
      metric_scope: "reporting_period",
      top_post_metric_scope: "lifetime",
      collected_at: endTime,
      profiles: sproutData.profiles || [],
      overall_totals: sproutData.overall_totals || {},
      top_posts: sproutData.top_posts || [],
      month_comparison: sproutData.month_comparison || {},
      platform_breakdown: sproutData.platform_breakdown || [],
      platform_metrics: sproutData.platform_metrics || {},
      top_posts_by_platform: sproutData.top_posts_by_platform || {},
    },
    tiktok_trends: { posts: tiktokTrends, patterns: { top_hashtags: topHashtags(tiktokTrends), avg_engagement: avgEngagement(tiktokTrends) } },
    instagram_trends: { posts: instagramTrends, patterns: { top_hashtags: topHashtags(instagramTrends), avg_engagement: avgEngagement(instagramTrends) } },
    ai_analysis: aiAnalysis,
    trend_status: trendStatus,
    content_calendar: calendar,
    context: {
      timezone: clientData.context?.timezone || config.timezone || "UTC",
      geo: geoArr,
      languages: languagesArr,
      brand_voice: clientData.context?.brand_voice || config.brand_voice || "",
      brand_book_text: clientData.context?.brand_book_text || config.brand_book_text || "",
      primary_platforms: clientData.context?.primary_platforms || config.primary_platforms || [],
      content_pillars: clientData.context?.content_pillars || config.content_pillars || [],
      brief_context: clientData.context?.brief_context || clientData.brief_context || {},
    },
    report_sections: presentationData.sections || presentationData.report_sections || [],
    gamma_url: presentationUrl,
    gamma_status: gammaSuccess ? "success" : gammaResult._gamma_timeout ? "timed_out" : "failed",
    warnings,
    data_counts: {
      total_recommendations: calendar.reduce((sum, day) => sum + (day.posts || []).length, 0) || presentationData.total_recommendations || 0,
      content_calendar_days: calendar.length,
      tiktok_trends: tiktokTrends.length,
      instagram_trends: instagramTrends.length,
      sprout_top_posts: (sproutData.top_posts || []).length,
      sprout_profiles: (sproutData.profiles || []).length,
    },
    metrics_summary: {
      impressions_change: sproutData.month_comparison?.changes?.impressions?.percent || 0,
      reactions_change: sproutData.month_comparison?.changes?.reactions?.percent || 0,
      link_clicks_change: sproutData.month_comparison?.changes?.link_clicks?.percent || 0,
      video_views_change: sproutData.month_comparison?.changes?.video_views?.percent || 0,
      comments_change: sproutData.month_comparison?.changes?.comments?.percent || 0,
      shares_change: sproutData.month_comparison?.changes?.shares?.percent || 0,
    },
  };
}
