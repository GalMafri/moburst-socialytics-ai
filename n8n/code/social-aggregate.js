// Aggregate Sprout Social Data — per-platform breakdown + top posts per platform (dynamic)
// Backwards compatible: keeps all original outputs, ADDS platform_breakdown + top_posts_by_platform.
const inputData = $input.all();

// Get date config - prefer Combine Brief Context (has correct dynamic dates)
let config = {};
try {
  const cbc = $('Combine Brief Context with Client Data').first().json;
  if (cbc && cbc.date_ranges) {
    config.current_month_start = cbc.date_ranges.current_month?.start || '';
    config.current_month_end = cbc.date_ranges.current_month?.end || '';
    config.previous_month_start = cbc.date_ranges.previous_month?.start || '';
    config.previous_month_end = cbc.date_ranges.previous_month?.end || '';
    console.log('✅ Got date config from Combine Brief Context');
  }
} catch(e) {}

if (!config.current_month_start) {
  try {
    const wfConfig = $('Workflow Configuration').first().json;
    config = { ...wfConfig };
    console.log('✅ Got date config from Workflow Configuration (fallback)');
  } catch (e) {
    console.log('⚠️ Could not get workflow config:', e.message);
  }
}

console.log('📅 Date Configuration:');
console.log('   Current period:', config.current_month_start, 'to', config.current_month_end);
console.log('   Previous period:', config.previous_month_start, 'to', config.previous_month_end);

let currentMonthData = [];
let previousMonthData = [];
let postAnalyticsData = [];
let profileMetadata = [];

// GET PROFILE METADATA
try {
  const profileData = $('Code in JavaScript').first().json;
  profileMetadata = profileData.profiles || [];
  console.log(`✅ Profile metadata: ${profileMetadata.length} profiles`);
} catch (e) {
  console.log('❌ Could not get profile metadata:', e.message);
}

// Read every HTTP pagination item, reject incomplete or out-of-window data.
function readRows(name, start, end, posts = false) {
  const pages = $(name).all();
  const rows = [];
  const seen = new Set();
  let expectedPages = 1;
  for (const item of pages) {
    const response = item.json;
    if (response.error || !Array.isArray(response.data)) throw new Error(name + ': no valid analytics response');
    expectedPages = Math.max(expectedPages, Number(response.paging?.total_pages || 1));
    for (const row of response.data) {
      const dims = row.dimensions || {};
      const field = Object.keys(dims).find(key => key.startsWith('reporting_period'));
      const date = posts ? String(row.created_time || '').slice(0, 10) : String(dims[field] || '').slice(0, 10);
      if (!posts && (!date || date < start || date > end)) throw new Error(name + ': returned a date outside the requested reporting period');
      const key = posts ? (row.guid || row.perma_link || JSON.stringify([dims.customer_profile_id, row.created_time, row.text])) : String(dims.customer_profile_id) + ':' + date;
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }
  }
  if (pages.length < expectedPages) throw new Error(name + ': not all API pages were retrieved');
  return rows;
}
currentMonthData = readRows('Get Sprout Social Analytics Data', config.current_month_start, config.current_month_end);
previousMonthData = readRows('Get Previous Month Sprout Analytics', config.previous_month_start, config.previous_month_end);
postAnalyticsData = readRows('Get Sprout Social Post Analytics', config.current_month_start, config.current_month_end, true);
const prevPostAnalyticsData = readRows('Get Previous Month Post Analytics', config.previous_month_start, config.previous_month_end, true);

// HELPER: Get metric - supports flat keys AND dot-notation nested access
function getMetric(metricsObj, ...keys) {
  if (!metricsObj) return 0;
  for (const key of keys) {
    const flatVal = metricsObj[key];
    if (flatVal !== undefined && flatVal !== null) return Number(flatVal) || 0;
    if (key.includes('.')) {
      const parts = key.split('.');
      let current = metricsObj;
      for (const part of parts) {
        if (current && typeof current === 'object') current = current[part];
        else { current = undefined; break; }
      }
      if (current !== undefined && current !== null) return Number(current) || 0;
    }
  }
  return 0;
}

// NETWORK TYPE MAPPING
const networkToDisplay = {
  'twitter': 'Twitter/X', 'facebook': 'Facebook', 'instagram': 'Instagram',
  'fb_instagram_account': 'Instagram', 'linkedin': 'LinkedIn',
  'linkedin_company': 'LinkedIn', 'tiktok': 'TikTok', 'youtube': 'YouTube',
  'pinterest': 'Pinterest', 'threads': 'Threads',
};
function getDisplayNetwork(s) {
  if (!s) return 'Unknown';
  return networkToDisplay[s.toLowerCase()] || s;
}

const profileIdToNetwork = {};
for (const p of profileMetadata) {
  const pid = String(p.id || p.customer_profile_id || '');
  if (pid) profileIdToNetwork[pid] = getDisplayNetwork(p.network || p.network_type || '');
}
// Augment the profile->network map from posts (posts carry both customer_profile_id AND network).
// This keeps per-platform attribution working even when profile metadata is incomplete (dynamic clients).
for (const post of postAnalyticsData.concat(prevPostAnalyticsData)) {
  const pid = String((post.dimensions || {}).customer_profile_id || post.customer_profile_id || '');
  const net = post.network_type || post.network || '';
  if (pid && net && !profileIdToNetwork[pid]) profileIdToNetwork[pid] = getDisplayNetwork(net);
}

const METRIC_KEYS = ['impressions', 'reactions', 'link_clicks', 'video_views', 'comments', 'shares', 'engagements'];

function extractProfileMetrics(metrics, network) {
  const reactions = getMetric(metrics, 'reactions', 'likes');
  const comments = getMetric(metrics, 'comments_count', 'comments');
  const shares = getMetric(metrics, 'shares_count', 'shares');
  const engagements = network === 'Instagram'
    ? getMetric(metrics, 'likes', 'reactions') + comments + shares + getMetric(metrics, 'saves') + getMetric(metrics, 'story_replies')
    : network === 'LinkedIn'
    ? reactions + comments + shares + getMetric(metrics, 'post_content_clicks', 'post_link_clicks')
    : reactions + comments + shares + getMetric(metrics, 'post_link_clicks') + getMetric(metrics, 'post_content_clicks_other');
  return {
    engagements,
    impressions: getMetric(metrics, 'impressions', 'lifetime.impressions'),
    reactions: getMetric(metrics, 'reactions', 'lifetime.reactions', 'likes'),
    link_clicks: getMetric(metrics, 'post_link_clicks', 'lifetime.post_link_clicks', 'link_clicks', 'clicks'),
    video_views: getMetric(metrics, 'video_views', 'lifetime.video_views'),
    comments: getMetric(metrics, 'comments_count', 'comments'),
    shares: getMetric(metrics, 'shares_count', 'shares'),
  };
}

function aggregateMetrics(dataArray) {
  const totals = Object.fromEntries(METRIC_KEYS.map(key => [key, 0]));
  for (const item of dataArray) {
    const m = extractProfileMetrics(item.metrics || item || {}, profileIdToNetwork[String(item.dimensions?.customer_profile_id || item.customer_profile_id || "")]);
    for (const k of METRIC_KEYS) totals[k] += m[k];
  }
  return totals;
}

const currentTotals = aggregateMetrics(currentMonthData);
const previousTotals = aggregateMetrics(previousMonthData);

// Period totals must never be replaced with lifetime metrics for selected posts.
console.log('📈 Aggregated Totals:');
console.log('   Current period:', JSON.stringify(currentTotals));
console.log('   Previous period:', JSON.stringify(previousTotals));

function calcChange(current, previous) {
  if (previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ── PER-PLATFORM AGGREGATION (dynamic) ───────────────────────────────────────
// Builds a per-network metric map from a profile-analytics array + a post-analytics array.
// Profile-level metrics (impressions/reactions/link_clicks/video_views) come from the profiles
// endpoint; comments/shares (and post_count) come from the posts endpoint (reliable source).
function buildPlatformMetrics(profileRecords, postRecords) {
  const pm = {};
  function ensure(dn) {
    if (!pm[dn]) {
      pm[dn] = {
        impressions: 0, reactions: 0, link_clicks: 0, video_views: 0, comments: 0, shares: 0,
        engagements: 0, post_count: 0, profile_names: [], profile_ids: [],
      };
    }
    return pm[dn];
  }
  // Seed every selected profile's platform so it appears even with zero activity
  for (const p of profileMetadata) {
    const dn = getDisplayNetwork(p.network || p.network_type || '');
    const entry = ensure(dn);
    const nm = p.native_name || p.name || '';
    const pid = p.id || p.customer_profile_id || '';
    if (nm && !entry.profile_names.includes(nm)) entry.profile_names.push(nm);
    if (pid !== '' && pid !== undefined && pid !== null && !entry.profile_ids.includes(pid)) entry.profile_ids.push(pid);
  }
  // Profile-level metrics
  for (const item of profileRecords) {
    const pid = String((item.dimensions || {}).customer_profile_id || item.customer_profile_id || '');
    const dn = profileIdToNetwork[pid] || null;
    if (!dn) continue;
    const entry = ensure(dn);
    const m = extractProfileMetrics(item.metrics || item || {}, profileIdToNetwork[String(item.dimensions?.customer_profile_id || item.customer_profile_id || "")]);
    entry.impressions += m.impressions;
    entry.reactions += m.reactions;
    entry.link_clicks += m.link_clicks;
    entry.video_views += m.video_views;
    entry.engagements += m.engagements;
    entry.post_count += getMetric(item.metrics, "posts_sent_count");
    entry.comments += m.comments;
    entry.shares += m.shares;
  }
  // Count posts published in the selected window; their metrics stay lifetime-scoped.
  for (const post of postRecords) {
    const pid = String((post.dimensions || {}).customer_profile_id || post.customer_profile_id || '');
    const netFromPost = post.network_type || post.network || '';
    const dn = netFromPost ? getDisplayNetwork(netFromPost) : (profileIdToNetwork[pid] || null);
    if (!dn) continue;
    const entry = ensure(dn);
    const m = post.metrics || {};
    // Published count comes from period profile analytics, not the top-post sample.
  }
  return pm;
}

const currentPlatform = buildPlatformMetrics(currentMonthData, postAnalyticsData);
const previousPlatform = buildPlatformMetrics(previousMonthData, prevPostAnalyticsData);

// platform_metrics (current-only object) — kept for backward compatibility / external consumers
const platformMetrics = {};
for (const dn of Object.keys(currentPlatform)) {
  const e = currentPlatform[dn];
  platformMetrics[dn] = {
    impressions: e.impressions, reactions: e.reactions, link_clicks: e.link_clicks,
    video_views: e.video_views, comments: e.comments, shares: e.shares, engagements: e.engagements,
    post_count: e.post_count,
    profile_name: (e.profile_names || [])[0] || '',
    profile_id: (e.profile_ids || [])[0] || '',
    profile_names: e.profile_names || [],
    profile_ids: e.profile_ids || [],
  };
}

// platform_breakdown (rich array with per-platform month-over-month) — primary new output
function pick6(o) {
  const out = {};
  for (const k of METRIC_KEYS) out[k] = (o && o[k]) || 0;
  return out;
}
const allNetworks = new Set([...Object.keys(currentPlatform), ...Object.keys(previousPlatform)]);
const platform_breakdown = [];
for (const dn of allNetworks) {
  if (dn === 'Unknown') continue; // don't surface unattributable buckets
  const cur = currentPlatform[dn] || {};
  const prev = previousPlatform[dn] || {};
  const changes = {};
  for (const metric of METRIC_KEYS) {
    const c = cur[metric] || 0;
    const p = prev[metric] || 0;
    changes[metric] = { current: c, previous: p, absolute: c - p, percent: calcChange(c, p) };
  }
  const profile_names = (cur.profile_names && cur.profile_names.length ? cur.profile_names : (prev.profile_names || []));
  const profile_ids = (cur.profile_ids && cur.profile_ids.length ? cur.profile_ids : (prev.profile_ids || []));
  platform_breakdown.push({
    network: dn,
    profile_names,
    profile_ids,
    current: pick6(cur),
    previous: pick6(prev),
    changes,
    post_count: cur.post_count || 0,
    previous_post_count: prev.post_count || 0,
    has_previous: Object.keys(prev).length > 0 && previousMonthData.length > 0,
  });
}
platform_breakdown.sort((a, b) => (b.current.impressions || 0) - (a.current.impressions || 0));

console.log(`📊 Platform breakdown: ${platform_breakdown.length} platforms`);
platform_breakdown.forEach(p => console.log(`   ${p.network}: ${p.current.impressions} impr, ${p.post_count} posts`));

const monthComparison = {
  current_month: currentTotals,
  previous_month: previousTotals,
  changes: {},
  summary: [],
  data_quality: {
    has_previous_month: previousMonthData.length > 0,
    current_records: currentMonthData.length,
    previous_records: previousMonthData.length
  }
};

for (const metric of METRIC_KEYS) {
  const current = currentTotals[metric] || 0;
  const previous = previousTotals[metric] || 0;
  const abs = current - previous;
  const pct = calcChange(current, previous);
  monthComparison.changes[metric] = { current, previous, absolute: abs, percent: pct };
  const dir = pct > 0 ? '↑' : (pct < 0 ? '↓' : '→');
  monthComparison.summary.push(`${metric.replace(/_/g, ' ')}: ${pct === null ? 'new activity (previous period was zero)' : dir + ' ' + Math.abs(pct) + '%'} (${abs >= 0 ? '+' : ''}${abs})`);
}

console.log('📊 MoM Summary:');
monthComparison.summary.forEach(s => console.log('   ' + s));

// ── POST MAPPING (shared by cross-platform top_posts AND per-platform grouping) ──
function mapPost(post) {
  const m = post.metrics || {};
  const impressions = getMetric(m, 'lifetime.impressions', 'impressions');
  const reactions = getMetric(m, 'lifetime.reactions', 'reactions', 'likes');
  const comments = getMetric(m, 'lifetime.comments_count', 'comments_count', 'comments', 'lifetime.comments');
  const shares = getMetric(m, 'lifetime.shares_count', 'shares_count', 'shares', 'lifetime.shares');
  const linkClicks = getMetric(m, 'lifetime.post_link_clicks', 'post_link_clicks', 'link_clicks');
  const videoViews = getMetric(m, 'lifetime.video_views', 'video_views');
  const engagements = getMetric(m, 'lifetime.engagements', 'engagements');
  const likes = getMetric(m, 'lifetime.likes', 'likes');
  const pid = String((post.dimensions || {}).customer_profile_id || post.customer_profile_id || '');
  const networkFromPost = post.network_type || post.network || '';
  const dn = networkFromPost ? getDisplayNetwork(networkFromPost) : (profileIdToNetwork[pid] || 'Unknown');
  return {
    permalink: post.perma_link || post.url || '',
    url: post.perma_link || post.url || '',
    text: post.text || post.caption || post.message || '',
    content: post.text || post.caption || post.message || '',
    network_type: dn.toUpperCase(),
    platform: dn.toUpperCase(),
    platform_display: dn,
    post_type: post.post_type || '',
    content_category: post.content_category || '',
    impressions, reactions, likes, comments, shares,
    link_clicks: linkClicks, video_views: videoViews, engagements,
    engagement: getMetric(m, 'lifetime.engagements') || (reactions + comments + shares + linkClicks),
    metric_scope: "lifetime",
    posted_at: post.created_time || ''
  };
}

const allMappedPosts = postAnalyticsData.map(mapPost).filter(post => post.url);

// Cross-platform top posts (unchanged shape/behavior — top 10 by engagement)
const topPosts = [...allMappedPosts].sort((a, b) => b.engagement - a.engagement).slice(0, 10);

// NEW: top posts per platform (dynamic). Group ALL fetched posts by platform, top N each.
const TOP_N_PER_PLATFORM = 5;
const grouped = {};
for (const post of allMappedPosts) {
  const dn = post.platform_display || 'Unknown';
  if (dn === 'Unknown') continue;
  if (!grouped[dn]) grouped[dn] = [];
  grouped[dn].push(post);
}
const top_posts_by_platform = {};
for (const dn of Object.keys(grouped)) {
  top_posts_by_platform[dn] = grouped[dn]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, TOP_N_PER_PLATFORM);
}

console.log(`✅ Top posts (cross-platform): ${topPosts.length}`);
console.log(`✅ Top posts by platform: ${Object.keys(top_posts_by_platform).map(k => `${k}(${top_posts_by_platform[k].length})`).join(', ')}`);

return [{ json: {
  profiles: profileMetadata.map(p => ({
    id: p.id || p.customer_profile_id,
    name: p.native_name || p.name,
    network: p.network || p.network_type,
    network_display: getDisplayNetwork(p.network || p.network_type || ''),
    url: p.native_link || ''
  })),
  platform_metrics: platformMetrics,
  platform_breakdown: platform_breakdown,
  overall_totals: currentTotals,
  metric_scope: "reporting_period",
  top_post_metric_scope: "lifetime",
  top_posts: topPosts,
  top_posts_by_platform: top_posts_by_platform,
  reporting_period: {
    current_month: { start: config.current_month_start, end: config.current_month_end },
    previous_month: { start: config.previous_month_start, end: config.previous_month_end }
  },
  month_comparison: monthComparison
}}];
