// Aggregate Competitive Data, the competitive workflow's main code node, as
// a function of its inputs.
//
// Ported from the repo's n8n/code/competitive-aggregate.js, not from the
// live node (EBiAwSay3H2R8krv version 079ef9fd): the repo mirror is the
// newer of the two. It carries the product's current definitions (Lital,
// 19 and 20 Oct 2026): one engagement rate (engagements divided by
// impressions, views on TikTok and YouTube, compared on likes, comments and
// shares), the post sample shared with the app (postSample.ts, which leaves
// Sprout's ad rows out), and the company figures from reportMetrics.ts. The
// live node still averages RivalIQ's per-post rate; n8n is frozen, so its
// node was never updated. Every screen recomputes a stored report with the
// same reportMetrics.ts when it reads it, so the figures a person sees are
// the same either way.
//
// A test runs the repo mirror next to this function on the same inputs.

import { engagementRate, isVideoNetwork, normalizedCompetitiveMetrics } from "../../competitive/reportMetrics.ts";
import { addPostToSample, emptyPostSample, finalizePostSample, postsInPeriod, topCounts } from "../../competitive/postSample.ts";
import type { RunConfig } from "./nodes.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface AggregateInputs {
  cfg: RunConfig;
  /** Resolve Landscape's output. */
  landscape: Any;
  /** Landscape Companies' answer. */
  companiesResp: Any;
  /** Merge Owned Posts' output: every post, the LinkedIn and Sprout figures. */
  postsResp: Any;
  /** RivalIQ's metrics answers; an error answer or none reads as no metrics. */
  metricsResp: Any;
  metricsPrevResp: Any;
  seriesResp: Any;
  audienceResp: Any;
  /** The request (the webhook body). */
  body: Any;
}

const objectOr = (v: Any) => (v && typeof v === "object" ? v : {});

export function aggregateCompetitive(i: AggregateInputs): Any {
  const cfg = i.cfg;
  const landscape = i.landscape;
  const companiesResp = objectOr(i.companiesResp);
  const postsResp = objectOr(i.postsResp);
  // RivalIQ's own period metrics: this period, the previous period of equal length, and the daily series.
  // Its per-follower rates are not collected: the product's one engagement rate is
  // engagements divided by impressions (views on video networks), see engagementRate().
  // Provider period metrics are authoritative; the callback withholds missing metrics.
  const metricsResp = objectOr(i.metricsResp);
  const metricsPrevResp = objectOr(i.metricsPrevResp);
  const seriesResp = objectOr(i.seriesResp);
  const audienceResp = objectOr(i.audienceResp);
  const mRows: Any[] = Array.isArray(metricsResp.metrics) ? metricsResp.metrics : [];
  const mPrevRows: Any[] = Array.isArray(metricsPrevResp.metrics) ? metricsPrevResp.metrics : [];
  const sRows: Any[] = Array.isArray(seriesResp.metrics) ? seriesResp.metrics : [];
  // Verify provider boundaries before attributing metrics to the report period.
  const day = (value: unknown) => String(value || "").slice(0, 10);
  const durationDays = Math.round((Date.parse(cfg.range_end) - Date.parse(cfg.range_start)) / 86400000) + 1;
  const prevEnd = new Date(Date.parse(cfg.range_start) - 86400000).toISOString().slice(0, 10);
  const prevStart = new Date(Date.parse(cfg.range_start) - durationDays * 86400000).toISOString().slice(0, 10);
  for (const [rows, start, end] of [[mRows, cfg.range_start, cfg.range_end], [mPrevRows, prevStart, prevEnd]] as Array<[Any[], string, string]>) {
    for (const row of rows) if (day(row.mainPeriodStart) !== start || day(row.mainPeriodEnd) !== end) {
      throw new Error("RivalIQ returned summary metrics for a different period. No report was produced from mismatched dates.");
    }
  }
  const byCompanyId = (rows: Any[]) => { const o: Record<string, Any> = {}; for (const r of rows) o[String(r.companyId)] = r; return o; };
  const mCur = byCompanyId(mRows);
  const mPrev = byCompanyId(mPrevRows);
  // A missing provider observation is unknown, not a measured zero.
  const pick = (r: Any, k: string) => { if (!r || r[k] == null || r[k] === "") return null; const n = Number(r[k]); return isFinite(n) ? n : null; };
  const NETS: Record<string, Record<string, string>> = {
    instagram: { followers: "instagramFollowedBy", posts: "instagramPosts", engagement: "instagramPostsEngagementTotal", impressions: "instagramEstimatedImpressions" },
    tiktok: { followers: "tikTokFollowers", posts: "tikTokPosts", engagement: "tikTokPostsEngagementTotal", impressions: "tikTokEstimatedImpressions", views: "tikTokViews" },
    facebook: { followers: "facebookPageLikes", posts: "facebookPosts", engagement: "facebookPostEngagementTotal", impressions: "facebookEstimatedImpressions", likely_boosted: "facebookLikelyBoostedPosts" },
    youtube: { followers: "youTubeSubscribers", posts: "youTubePosts", engagement: "youTubePostsEngagementTotal", impressions: "youTubeEstimatedImpressions", views: "youTubePostViews" },
    twitter: { posts: "twitterTweets", engagement: "twitterTweetEngagementTotal", impressions: "twitterEstimatedImpressions" },
  };
  const metricsFor = (id: string) => {
    const cur = mCur[id];
    if (!cur) return null;
    const prev = mPrev[id] || null;
    const both = (k: string) => ({ current: pick(cur, k), previous: prev ? pick(prev, k) : null });
    const by_network: Record<string, Any> = {};
    for (const net of Object.keys(NETS)) {
      const keys = NETS[net]; const n: Record<string, Any> = {}; let any = false;
      for (const field of Object.keys(keys)) { const v = both(keys[field]); n[field] = v; if (v.current != null || v.previous != null) any = true; }
      if (any) by_network[net] = n;
    }
    const daily = sRows.filter((r) => String(r.companyId) === id && day(r.date) >= cfg.range_start && day(r.date) <= cfg.range_end).map((r) => ({ date: String(r.date || "").slice(0, 10), posts: pick(r, "crossChannelSocialActivity"), engagement: pick(r, "crossChannelSocialEngagement"), audience: pick(r, "crossChannelSocialAudience") })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return {
      period: { start: String(cur.mainPeriodStart || "").slice(0, 10), end: String(cur.mainPeriodEnd || "").slice(0, 10) },
      previous_period: prev ? { start: String(prev.mainPeriodStart || "").slice(0, 10), end: String(prev.mainPeriodEnd || "").slice(0, 10) } : null,
      audience: both("crossChannelSocialAudience"),
      engagement: both("crossChannelSocialEngagement"),
      estimated_impressions: both("crossChannelEstimatedImpressions"),
      posts: both("crossChannelSocialActivity"),
      likely_boosted_facebook_posts: both("facebookLikelyBoostedPosts"),
      by_network,
      daily,
    };
  };
  const fromEndpoint: Any[] = companiesResp.companies || companiesResp.data || companiesResp.items || (Array.isArray(companiesResp) ? companiesResp : []);
  const allowedIds = landscape.selected_company_ids ? new Set([landscape.client_company_id, ...landscape.selected_company_ids].map(String)) : null;
  const companies = (fromEndpoint.length > 0 ? fromEndpoint : (landscape.companies || [])).filter((c: Any) => !allowedIds || allowedIds.has(String(c.id)));
  const rawPosts = postsResp.socialPosts || postsResp.posts || postsResp.data || postsResp.items || (Array.isArray(postsResp) ? postsResp : []);
  if (Number(postsResp.failed_windows) > 0 || Number(postsResp.truncated_pages) > 0) throw new Error("RivalIQ post coverage is incomplete. The report cannot be presented as a complete period.");
  // Posts dated in the period, each once, X dates read from native ids (postSample.ts postsInPeriod).
  const posts = postsInPeriod(rawPosts, cfg.range_start, cfg.range_end, allowedIds);
  const truncatedPages = Number(postsResp.truncated_pages) || 0;
  let selected: Any[] = []; try { selected = JSON.parse(cfg.competitors_json || "[]"); } catch { selected = []; }
  let suppressed: Any[] = []; try { suppressed = JSON.parse(cfg.suppressed_insights_json || "[]"); } catch { suppressed = []; }
  const clientNeedle = String(cfg.client_name || "").toLowerCase();
  const body = i.body || {};
  const host = (value: unknown) => String(value || "").toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  const clientHost = host(body.website_url);
  const clientMatches = companies.filter((c: Any) => {
    if (landscape.client_company_id != null) return String(c.id) === String(landscape.client_company_id);
    const name = String(c.name || c.company_name || "").toLowerCase().trim();
    return (!!clientHost && host(c.url) === clientHost) || (!!name && !!clientNeedle && (name.includes(clientNeedle) || clientNeedle.includes(name)));
  });
  if (clientMatches.length !== 1) throw new Error("CLIENT_IDENTITY_UNVERIFIED: the RivalIQ landscape must track exactly one company matching " + cfg.client_name + ". A focus company is not automatically the client.");
  const verifiedClientId = String(clientMatches[0].id ?? clientMatches[0].company_id);
  // deno-lint-ignore no-control-regex
  // eslint-disable-next-line no-control-regex
  const clean = (s: unknown) => String(s || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  // The post sample (counts by weekday and hour, hashtags, formats, top posts)
  // is postSample.ts, shared with the app.
  const blank = (key: string, name: string, url: unknown) => ({ company_id: key, name, url: url || null, is_client: false, in_confirmed_top3: false, ...emptyPostSample(), channels: {}, by_channel: {} as Record<string, Any> });
  const byCompany: Record<string, Any> = {};
  for (const c of companies) {
    const key = String(c.id ?? c.company_id ?? c.name);
    const name = clean(c.name || c.company_name || key);
    const lower = name.toLowerCase();
    const agg = blank(key, name, c.url);
    agg.is_client = key === verifiedClientId;
    agg.in_confirmed_top3 = selected.some((s) => { const sn = String(s.name || "").toLowerCase(); return !!sn && (lower.includes(sn) || sn.includes(lower)); });
    byCompany[key] = agg;
  }
  for (const p of posts) {
    const key = String(p.companyId ?? p.company_id ?? (p.company && p.company.id) ?? "unknown");
    if (!byCompany[key]) byCompany[key] = blank(key, clean(p.companyName || p.company_name || "Unknown " + key), null);
    const agg = byCompany[key];
    const channel = addPostToSample(agg, p);
    if (!agg.by_channel[channel]) agg.by_channel[channel] = emptyPostSample();
    addPostToSample(agg.by_channel[channel], p);
  }
  const days = Math.max(1, Math.round((new Date(cfg.range_end).getTime() - new Date(cfg.range_start).getTime()) / 86400000) + 1);
  const finalize = (b: Any) => finalizePostSample(b, days);
  const companiesOut = Object.values(byCompany).map((c: Any) => {
    finalize(c);
    c.channel_mix = topCounts(c.channels, 8); delete c.channels;
    for (const ch of Object.keys(c.by_channel)) finalize(c.by_channel[ch]);
    c.rivaliq_metrics = metricsFor(String(c.company_id));
    const audience = (audienceResp.metrics || []).find((row: Any) => String(row.companyId) === String(c.company_id));
    if (audience && pick(audience, "crossChannelSocialAudience") != null) {
      c.rivaliq_audience_snapshot = {
        as_of: day(audience.mainPeriodEnd), source: "rivaliq",
        audience: pick(audience, "crossChannelSocialAudience"),
        by_network: Object.fromEntries(Object.entries(NETS).filter(([, fields]) => fields.followers && pick(audience, fields.followers) != null).map(([network, fields]) => [network, pick(audience, fields.followers)])),
      };
    }
    c.linkedin_metrics = postsResp.additional_metrics?.[String(c.company_id)] || null;
    c.owned_metrics = postsResp.owned_metrics?.[String(c.company_id)] || null;
    // Use the provider's aggregation, not a differently weighted mean of posts.
    // The rate is engagements divided by impressions (views on video networks).
    const applyProvider = (b: Any, metrics: Any, network: string | null) => {
      b.observed_post_count = b.post_count;
      if (!metrics) return;
      const value = (key: string) => metrics[key]?.current;
      if (value("posts") != null) b.post_count = value("posts");
      b.cadence_per_week = Math.round(b.post_count / days * 70) / 10;
      const reach = isVideoNetwork(network) && value("views") != null ? value("views") : value("impressions");
      b.engagement_rate_avg = value("posts") === 0 ? null : engagementRate(value("engagement"), reach);
      b.engagement_avg = value("engagement") != null && b.post_count ? value("engagement") / b.post_count : null;
      b.impressions_total = value("impressions") ?? null;
      b.impressions_avg = value("impressions") != null && b.post_count ? value("impressions") / b.post_count : null;
    };
    if (c.rivaliq_metrics) {
      applyProvider(c, { ...c.rivaliq_metrics, impressions: c.rivaliq_metrics.estimated_impressions }, null);
      for (const network of Object.keys(c.rivaliq_metrics.by_network)) {
        const key = network === "twitter" && c.by_channel.x ? "x" : network;
        if (!c.by_channel[key]) c.by_channel[key] = finalize(emptyPostSample());
      }
      for (const [channel, b] of Object.entries(c.by_channel)) applyProvider(b, c.rivaliq_metrics.by_network[channel === "x" ? "twitter" : channel], channel);
    }
    return c;
  });
  const allTop = companiesOut.flatMap((c: Any) => c.top_posts.map((p: Any) => ({ company: c.name, ...p })));
  const note = posts.length === 0 ? "RivalIQ returned zero posts for this landscape and period." : (truncatedPages > 0 ? (truncatedPages + " weekly window" + (truncatedPages === 1 ? "" : "s") + " hit RivalIQ's 500-post page limit, so some posts in the period may be missing.") : "");
  const metricsAvailable = mRows.length > 0;
  const result = { metric_semantics_version: 4, metric_scope: "rivaliq_period_totals_with_separate_post_sample", client_name: cfg.client_name, landscape: { id: landscape.landscape_id, name: landscape.landscape_name, matched_by: landscape.matched_by }, period: { start: cfg.range_start, end: cfg.range_end, days }, total_posts_analyzed: posts.length, metrics_available: metricsAvailable, metrics_note: metricsAvailable ? "" : "RivalIQ period metrics (followers, engagement, impressions) were not returned for this run.", companies: companiesOut, example_post_pool: allTop.map((p: Any) => ({ company: p.company, url: p.url, channel: p.channel, engagement: p.engagement })), suppressed_insights: suppressed, schema_note: note };
  return normalizedCompetitiveMetrics({ aggregates: result }).aggregates;
}
