const cfg = $("Run Config").first().json;
const landscape = $("Resolve Landscape").first().json;
const companiesResp = $("Landscape Companies").first().json;
const postsResp = $input.first().json;
// RivalIQ's own period metrics: this period, the previous period of equal length, and the daily series.
// Optional: a failed metrics call leaves rivaliq_metrics null and the run continues on posts alone.
const safeJson = (name) => { try { const j = $(name).first().json; return j && typeof j === "object" ? j : {}; } catch (e) { return {}; } };
const metricsResp = safeJson("Landscape Metrics Summary");
const metricsPrevResp = safeJson("Landscape Metrics Summary Previous");
const seriesResp = safeJson("Landscape Metrics Timeseries");
const mRows = Array.isArray(metricsResp.metrics) ? metricsResp.metrics : [];
const mPrevRows = Array.isArray(metricsPrevResp.metrics) ? metricsPrevResp.metrics : [];
const sRows = Array.isArray(seriesResp.metrics) ? seriesResp.metrics : [];
// Verify provider boundaries before attributing metrics to the report period.
const day = value => String(value || '').slice(0, 10);
const durationDays = Math.round((Date.parse(cfg.range_end) - Date.parse(cfg.range_start)) / 86400000) + 1;
const prevEnd = new Date(Date.parse(cfg.range_start) - 86400000).toISOString().slice(0, 10);
const prevStart = new Date(Date.parse(cfg.range_start) - durationDays * 86400000).toISOString().slice(0, 10);
for (const [rows, start, end] of [[mRows, cfg.range_start, cfg.range_end], [mPrevRows, prevStart, prevEnd]]) {
  for (const row of rows) if (day(row.mainPeriodStart) !== start || day(row.mainPeriodEnd) !== end) {
    throw new Error('RivalIQ returned summary metrics for a different period. No report was produced from mismatched dates.');
  }
}
const byCompanyId = (rows) => { const o = {}; for (const r of rows) o[String(r.companyId)] = r; return o; };
const mCur = byCompanyId(mRows);
const mPrev = byCompanyId(mPrevRows);
const pick = (r, k) => { if (!r || r[k] == null) return 0; const n = Number(r[k]); return isFinite(n) ? n : 0; };
const NETS = {
  instagram: { followers: "instagramFollowedBy", posts: "instagramPosts", engagement: "instagramPostsEngagementTotal", impressions: "instagramEstimatedImpressions", rate: "instagramAverageEngagementRatePerPost" },
  tiktok: { followers: "tikTokFollowers", posts: "tikTokPosts", engagement: "tikTokPostsEngagementTotal", impressions: "tikTokEstimatedImpressions", views: "tikTokViews", rate: "tikTokEngagementRateByFollower" },
  facebook: { followers: "facebookPageLikes", posts: "facebookPosts", engagement: "facebookPostEngagementTotal", impressions: "facebookEstimatedImpressions", rate: "facebookAverageEngagementRatePerPost", likely_boosted: "facebookLikelyBoostedPosts" },
  youtube: { followers: "youTubeSubscribers", posts: "youTubePosts", engagement: "youTubePostsEngagementTotal", impressions: "youTubeEstimatedImpressions", views: "youTubePostViews", rate: "youTubeAverageEngagementRatePerPost" },
  twitter: { posts: "twitterTweets", engagement: "twitterTweetEngagementTotal", impressions: "twitterEstimatedImpressions", rate: "twitterAverageEngagementRatePerTweet" }
};
const metricsFor = (id) => {
  const cur = mCur[id];
  if (!cur) return null;
  const prev = mPrev[id] || null;
  const both = (k) => ({ current: pick(cur, k), previous: prev ? pick(prev, k) : null });
  const by_network = {};
  for (const net of Object.keys(NETS)) {
    const keys = NETS[net]; const n = {}; let any = false;
    for (const field of Object.keys(keys)) { const v = both(keys[field]); n[field] = v; if (v.current || v.previous) any = true; }
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
    engagement_rate_per_post: both("crossChannelAverageEngagementRatePerPost"),
    likely_boosted_facebook_posts: both("facebookLikelyBoostedPosts"),
    by_network,
    daily
  };
};
const fromEndpoint = companiesResp.companies || companiesResp.data || companiesResp.items || (Array.isArray(companiesResp) ? companiesResp : []);
const companies = fromEndpoint.length > 0 ? fromEndpoint : (landscape.companies || []);
const rawPosts = postsResp.socialPosts || postsResp.posts || postsResp.data || postsResp.items || (Array.isArray(postsResp) ? postsResp : []);
if (Number(postsResp.failed_windows) > 0 || Number(postsResp.truncated_pages) > 0) throw new Error('RivalIQ post coverage is incomplete. The report cannot be presented as a complete period.');
const seenPosts = new Set();
const posts = rawPosts.filter(post => {
  const date = day(post.publishedAt || post.published_at || post.created || post.created_at || post.date);
  if (!date || date < cfg.range_start || date > cfg.range_end) return false;
  const key = String(post.postId || post.postLink || JSON.stringify([post.companyId, date, post.message]));
  if (seenPosts.has(key)) return false;
  seenPosts.add(key); return true;
});
const truncatedPages = Number(postsResp.truncated_pages) || 0;
let selected = []; try { selected = JSON.parse(cfg.competitors_json || "[]"); } catch (e) { selected = []; }
let suppressed = []; try { suppressed = JSON.parse(cfg.suppressed_insights_json || "[]"); } catch (e) { suppressed = []; }
const clientNeedle = String(cfg.client_name || "").toLowerCase();
const body = safeJson('Competitive Webhook').body || {};
const host = value => String(value || '').toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
const clientHost = host(body.website_url);
const clientMatches = companies.filter(c => {
  if (landscape.client_company_id != null) return String(c.id) === String(landscape.client_company_id);
  const name = String(c.name || c.company_name || '').toLowerCase().trim();
  return (!!clientHost && host(c.url) === clientHost) || (!!name && !!clientNeedle && (name.includes(clientNeedle) || clientNeedle.includes(name)));
});
if (clientMatches.length !== 1) throw new Error('CLIENT_IDENTITY_UNVERIFIED — the RivalIQ landscape must track exactly one company matching ' + cfg.client_name + '. A focus company is not automatically the client.');
const verifiedClientId = String(clientMatches[0].id ?? clientMatches[0].company_id);
const clean = (s) => String(s || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
const num = (v) => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : 0));
// RivalIQ's paid signal on Facebook posts is a string: "Likely Boosted", "Not Likely Boosted" or "No Prediction".
const isBoosted = (v) => (typeof v === "string" ? v.trim().toLowerCase() === "likely boosted" : v === true);
const bucket = () => ({ post_count: 0, likely_boosted_posts: 0, engagement_sum: 0, engagement_rate_sum: 0, views_total: 0, impressions_total: 0, reach_total: 0, by_weekday: {}, by_hour: {}, hashtags: {}, media_types: {}, top_posts: [] });
const blank = (key, name, url) => ({ company_id: key, name, url: url || null, is_client: false, in_confirmed_top3: false, ...bucket(), channels: {}, by_channel: {} });
const byCompany = {};
for (const c of companies) {
  const key = String(c.id ?? c.company_id ?? c.name);
  const name = clean(c.name || c.company_name || key);
  const lower = name.toLowerCase();
  const agg = blank(key, name, c.url);
  agg.is_client = key === verifiedClientId;
  agg.in_confirmed_top3 = selected.some((s) => { const sn = String(s.name || "").toLowerCase(); return !!sn && (lower.includes(sn) || sn.includes(lower)); });
  byCompany[key] = agg;
}
const addPost = (agg, p) => {
  agg.post_count += 1;
  const boosted = isBoosted(p.facebookLikelyBoosted);
  if (boosted) agg.likely_boosted_posts += 1;
  const engagement = num(p.engagementTotal) || num(p.engagement_total) || (num(p.applause) + num(p.conversation) + num(p.amplification));
  const rate = num(p.engagementRate);
  const views = num(p.views) || num(p.youtubeViews) || num(p.tiktokViews) || num(p.facebookPostViews) || 0;
  const impressions = num(p.estimatedImpressions);
  const reach = num(p.presenceReach);
  agg.engagement_sum += engagement; agg.engagement_rate_sum += rate; agg.views_total += views; agg.impressions_total += impressions; agg.reach_total += reach;
  const created = p.publishedAt || p.published_at || p.created || p.created_at || p.date;
  if (created) { const d = new Date(created); if (!isNaN(d)) { const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()]; agg.by_weekday[wd] = (agg.by_weekday[wd] || 0) + 1; const hr = String(d.getUTCHours()); agg.by_hour[hr] = (agg.by_hour[hr] || 0) + 1; } }
  const text = clean(p.message || p.text || p.caption || p.content || "");
  for (const t of (text.match(/#[\p{L}0-9_]+/gu) || [])) { agg.hashtags[t.toLowerCase()] = (agg.hashtags[t.toLowerCase()] || 0) + 1; }
  const mtype = p.type || p.post_type || p.media_type || "unknown";
  agg.media_types[mtype] = (agg.media_types[mtype] || 0) + 1;
  const channel = p.channel || p.network || p.platform || "unknown";
  if (agg.channels) agg.channels[channel] = (agg.channels[channel] || 0) + 1;
  agg.top_posts.push({ engagement, engagement_rate: rate, est_impressions: impressions, reach, views, applause: num(p.applause), conversation: num(p.conversation), amplification: num(p.amplification), text: text.slice(0, 220), url: p.postLink || p.permalink || p.url || p.link || null, image: p.image || p.imageLarge || null, created: created || null, media_type: mtype, channel, likely_boosted: boosted, boosted_prediction: typeof p.facebookLikelyBoosted === "string" ? p.facebookLikelyBoosted : null });
  return channel;
};
for (const p of posts) {
  const key = String(p.companyId ?? p.company_id ?? (p.company && p.company.id) ?? "unknown");
  if (!byCompany[key]) byCompany[key] = blank(key, clean(p.companyName || p.company_name || "Unknown " + key), null);
  const agg = byCompany[key];
  const channel = addPost(agg, p);
  if (!agg.by_channel[channel]) agg.by_channel[channel] = bucket();
  addPost(agg.by_channel[channel], p);
}
const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
const days = Math.max(1, Math.round((new Date(cfg.range_end) - new Date(cfg.range_start)) / 86400000) + 1);
const finalize = (b) => {
  b.engagement_avg = b.post_count ? Math.round((b.engagement_sum / b.post_count) * 10) / 10 : 0;
  b.engagement_rate_avg = b.post_count ? Math.round((b.engagement_rate_sum / b.post_count) * 10000) / 10000 : 0;
  b.impressions_avg = b.post_count ? Math.round(b.impressions_total / b.post_count) : 0;
  b.cadence_per_week = Math.round(((b.post_count / days) * 7) * 10) / 10;
  b.top_hashtags = topN(b.hashtags, 10);
  b.media_type_mix = topN(b.media_types, 8);
  b.top_posts = b.top_posts.sort((x, y) => y.engagement - x.engagement).slice(0, 5);
  delete b.hashtags; delete b.media_types; delete b.engagement_sum; delete b.engagement_rate_sum;
  return b;
};
const companiesOut = Object.values(byCompany).map((c) => {
  finalize(c);
  c.channel_mix = topN(c.channels, 8); delete c.channels;
  for (const ch of Object.keys(c.by_channel)) finalize(c.by_channel[ch]);
  c.rivaliq_metrics = metricsFor(String(c.company_id));
  return c;
});
const allTop = companiesOut.flatMap((c) => c.top_posts.map((p) => ({ company: c.name, ...p })));
const note = posts.length === 0 ? "RivalIQ returned zero posts for this landscape and period." : (truncatedPages > 0 ? (truncatedPages + " weekly window" + (truncatedPages === 1 ? "" : "s") + " hit RivalIQ's 500-post page limit, so some posts in the period may be missing.") : "");
const metricsAvailable = mRows.length > 0;
return [{ json: { client_name: cfg.client_name, landscape: { id: landscape.landscape_id, name: landscape.landscape_name, matched_by: landscape.matched_by }, period: { start: cfg.range_start, end: cfg.range_end, days }, total_posts_analyzed: posts.length, metrics_available: metricsAvailable, metrics_note: metricsAvailable ? "" : "RivalIQ period metrics (followers, engagement, impressions) were not returned for this run.", companies: companiesOut, example_post_pool: allTop.map((p) => ({ company: p.company, url: p.url, channel: p.channel, engagement: p.engagement })), suppressed_insights: suppressed, schema_note: note } }];
