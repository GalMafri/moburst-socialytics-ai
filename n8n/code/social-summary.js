// Generate Run Summary - FIXED: gammaUrl extraction + status passthrough
const gammaResult = $input.first().json;
const presentationData = $('Build Presentation Content').first().json;

let clientData = {};
let startTime = new Date().toISOString();

try {
  clientData = $('Build Normalized Client Object').first().json;
} catch(e) {
  console.log('Could not get client data');
}

// === RESILIENT CONFIG / DATE FETCH ===
let config = {};
// Priority 1: Combine Brief Context (has correct dynamic date ranges from webhook)
try {
  const cbc = $('Combine Brief Context with Client Data').first().json;
  if (cbc && cbc.date_ranges) {
    config.current_month_start = cbc.date_ranges.current_month?.start || '';
    config.current_month_end = cbc.date_ranges.current_month?.end || '';
    config.previous_month_start = cbc.date_ranges.previous_month?.start || '';
    config.previous_month_end = cbc.date_ranges.previous_month?.end || '';
    config.client_name = cbc.client_name;
    config.report_id = cbc.report_id;
    console.log('✅ Config from Combine Brief Context');
  }
} catch(e) {}

// Priority 2: Workflow Configuration (fallback)
if (!config.current_month_start) {
  try {
    const wf = $('Workflow Configuration').first().json;
    if (wf && wf.current_month_start) {
      config = wf;
      startTime = wf.workflow_start_time || startTime;
      console.log('✅ Config from Workflow Configuration (fallback)');
    }
  } catch(e) {}
}

if (!config.current_month_start) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const fmt = (d) => d.toISOString().split('T')[0];
  config.current_month_start = fmt(new Date(year, month, 1));
  config.current_month_end = fmt(now);
  config.previous_month_start = fmt(new Date(year, month - 1, 1));
  config.previous_month_end = fmt(new Date(year, month, 0));
  console.log('⚠️ Computed dates fresh');
}

// === RESILIENT report_id FETCH ===
let reportId = '';
try {
  reportId = $('Combine Brief Context with Client Data').first().json.report_id;
} catch(e) {}
if (!reportId) {
  try { reportId = $('Workflow Configuration').first().json.report_id; } catch(e) {}
}
if (!reportId) {
  try {
    const wh = $('Webhook').first().json;
    reportId = wh.body?.report_id || wh.report_id || '';
  } catch(e) {}
}
if (!reportId) {
  reportId = config.report_id || '';
}
console.log(`📋 Report ID: ${reportId || 'MISSING'}`);

// Get aggregated Sprout data
let sproutData = {};
try {
  sproutData = $('Aggregate Sprout Social Data').first().json;
} catch(e) {
  console.log('Could not get sprout data');
}

// Get AI analysis — unwrap the agent output
let aiAnalysis = {};
try {
  const aiRaw = $('AI Synthesis Agent').first().json;

  if (aiRaw.output) {
    try {
      aiAnalysis = typeof aiRaw.output === 'string' ? JSON.parse(aiRaw.output) : aiRaw.output;
    } catch(e2) {
      aiAnalysis = aiRaw.output;
    }
  } else if (aiRaw.text) {
    try {
      aiAnalysis = typeof aiRaw.text === 'string' ? JSON.parse(aiRaw.text) : aiRaw.text;
    } catch(e2) {
      aiAnalysis = aiRaw.text;
    }
  } else if (aiRaw.sprout_performance_analysis) {
    aiAnalysis = aiRaw;
  } else if (typeof aiRaw === 'string') {
    try { aiAnalysis = JSON.parse(aiRaw); } catch(e2) { aiAnalysis = {}; }
  } else {
    aiAnalysis = aiRaw;
  }
} catch(e) {
  console.log('❌ Could not get AI analysis:', e.message);
}

const endTime = new Date().toISOString();
const durationMins = Math.round((new Date(endTime) - new Date(startTime)) / 60000);

// === FIX: Extract presentation URL — gammaUrl is the FIRST check ===
const candidateUrl =
  gammaResult.gammaUrl ||
  gammaResult.url ||
  gammaResult.shareUrl ||
  gammaResult.shareLink ||
  gammaResult.share_url ||
  gammaResult.share_link ||
  gammaResult.exportUrl ||
  gammaResult.export_url ||
  gammaResult.viewUrl ||
  gammaResult.view_url ||
  (gammaResult.data?.gammaUrl) ||
  (gammaResult.data?.url) ||
  (gammaResult.data?.shareUrl) ||
  (gammaResult.data?.shareLink) ||
  (gammaResult.result?.url) ||
  (gammaResult.result?.shareUrl) ||
  (gammaResult.link) ||
  (gammaResult.generatedContentUrl) ||
  (gammaResult.data?.link) ||
  (gammaResult.data?.generatedContentUrl) ||
  (gammaResult.generation?.url) ||
  (gammaResult.generation?.shareUrl) ||
  (gammaResult.generation?.link) ||
  (gammaResult.output?.url) ||
  (gammaResult.output?.shareUrl) ||
  null;

const gammaState = String(gammaResult.status || gammaResult.data?.status || '').toLowerCase();
const validUrl = typeof candidateUrl === 'string' && /^https:\/\/[^\s]+$/i.test(candidateUrl);
const gammaSuccess = gammaState === 'completed' && validUrl;
const presentationUrl = gammaSuccess ? candidateUrl : null;
const isSuccess = !!aiAnalysis && typeof aiAnalysis === 'object' && !aiAnalysis.error && ['content_calendar', 'sprout_performance_analysis', 'executive_summary'].some(key => aiAnalysis[key] != null);
const warnings = [];
if (!gammaSuccess) warnings.push(gammaResult._gamma_timeout
  ? 'The analysis is available, but presentation generation timed out. No presentation link is available.'
  : 'The analysis is available, but the presentation did not complete. No presentation link is available.');
try {
  const briefWarning = $('Prepare Brief Text').first().json.brief_warning;
  if (briefWarning) warnings.push(briefWarning);
  const combinedWarning = $('Combine Brief Context with Client Data').first().json.brief_warning;
  if (combinedWarning && !warnings.includes(combinedWarning)) warnings.push(combinedWarning);
} catch (error) {}


console.log('\n🔍 GAMMA RESPONSE DEBUG:');
console.log('  Full response keys:', Object.keys(gammaResult));
console.log('  Response (first 500 chars):', JSON.stringify(gammaResult).substring(0, 500));
if (gammaResult.data) console.log('  data keys:', Object.keys(gammaResult.data));
if (gammaResult.result) console.log('  result keys:', Object.keys(gammaResult.result));
if (gammaResult.generation) console.log('  generation keys:', Object.keys(gammaResult.generation));
if (gammaResult.output) console.log('  output keys:', Object.keys(gammaResult.output));
console.log('  Extracted presentationUrl:', presentationUrl || 'NONE');

if (!presentationUrl) {
  console.log('⚠️ WARNING: No presentation URL found from Gamma response!');
  console.log('  Trying to construct from ID:', gammaResult.id || gammaResult.data?.id || gammaResult.generationId || 'NO ID');
}

const tiktokTrends = clientData.trends?.tiktok?.posts || clientData.tiktok_trends || [];
const instagramTrends = clientData.trends?.instagram?.posts || clientData.instagram_trends || [];

function extractTopHashtags(posts, limit = 10) {
  const tagCounts = {};
  for (const post of posts) {
    const tags = post.hashtags || [];
    for (const tag of tags) {
      const clean = String(tag).toLowerCase().replace(/^#/, '');
      if (clean) tagCounts[clean] = (tagCounts[clean] || 0) + 1;
    }
  }
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

function avgEngagement(posts) {
  if (!posts.length) return 0;
  const total = posts.reduce((sum, p) => sum + (p.engagement_score || 0), 0);
  return Math.round(total / posts.length);
}

// === MULTI-GEO: ensure array ===
let geoArr = clientData.context?.geo || config.geo || ['US'];
if (typeof geoArr === 'string') geoArr = geoArr.split(',').map(s => s.trim()).filter(Boolean);
if (!Array.isArray(geoArr)) geoArr = [geoArr];

// === MULTI-LANGUAGE: ensure array ===
let languagesArr = clientData.context?.languages || clientData.context?.language || config.languages || config.language || ['en'];
if (typeof languagesArr === 'string') languagesArr = languagesArr.split(',').map(s => s.trim()).filter(Boolean);
if (!Array.isArray(languagesArr)) languagesArr = [languagesArr];

// === BRAND VOICE ===
const brandVoice = clientData.context?.brand_voice || config.brand_voice || '';
const brandBookText = clientData.context?.brand_book_text || config.brand_book_text || '';

let trendStatus = {};
try { trendStatus = $('Prepare Trend Inputs').first().json.trend_status || {}; } catch (error) {}
for (const [platform, state] of Object.entries(trendStatus)) {
  if (state === 'missing_keywords') warnings.push(`${platform === 'tiktok' ? 'TikTok' : 'Instagram'} trend analysis could not run because there were no usable keywords. Add keywords in client setup.`);
}
const fullReport = {
  report_id: reportId,
  status: isSuccess ? 'success' : 'failed',
  client_name: presentationData.client_name || clientData.client_name || config.client_name || 'Unknown',
  report_date: new Date().toISOString().split('T')[0],
  started_at: startTime,
  completed_at: endTime,
  duration_minutes: durationMins,

  report_period: {
    current_month: {
      start: (config.current_month_start || '').trim(),
      end: (config.current_month_end || '').trim()
    },
    previous_month: {
      start: (config.previous_month_start || '').trim(),
      end: (config.previous_month_end || '').trim()
    }
  },

  sprout_performance: {
    profiles: sproutData.profiles || [],
    overall_totals: sproutData.overall_totals || {},
    top_posts: sproutData.top_posts || [],
    month_comparison: sproutData.month_comparison || {},
    platform_breakdown: sproutData.platform_breakdown || [],
    platform_metrics: sproutData.platform_metrics || {},
    top_posts_by_platform: sproutData.top_posts_by_platform || {},
  },

  tiktok_trends: {
    posts: tiktokTrends,
    patterns: {
      top_hashtags: extractTopHashtags(tiktokTrends),
      avg_engagement: avgEngagement(tiktokTrends)
    }
  },

  instagram_trends: {
    posts: instagramTrends,
    patterns: {
      top_hashtags: extractTopHashtags(instagramTrends),
      avg_engagement: avgEngagement(instagramTrends)
    }
  },

  ai_analysis: aiAnalysis,
  trend_status: trendStatus,

  content_calendar: aiAnalysis.content_calendar || [],

  context: {
    timezone: clientData.context?.timezone || config.timezone || 'UTC',
    geo: geoArr,
    languages: languagesArr,
    brand_voice: brandVoice,
    brand_book_text: brandBookText,
    primary_platforms: clientData.context?.primary_platforms || config.primary_platforms || [],
    content_pillars: clientData.context?.content_pillars || config.content_pillars || [],
    brief_context: clientData.context?.brief_context || clientData.brief_context || {}
  },

  report_sections: presentationData.sections || presentationData.report_sections || [],

  gamma_url: presentationUrl,
  gamma_status: gammaSuccess ? 'success' : gammaResult._gamma_timeout ? 'timed_out' : 'failed',
  warnings,

  data_counts: {
    total_recommendations: (aiAnalysis.content_calendar || []).reduce((sum, day) => sum + (day.posts || []).length, 0) || presentationData.total_recommendations || 0,
    content_calendar_days: (aiAnalysis.content_calendar || []).length,
    tiktok_trends: tiktokTrends.length,
    instagram_trends: instagramTrends.length,
    sprout_top_posts: (sproutData.top_posts || []).length,
    sprout_profiles: (sproutData.profiles || []).length
  },

  metrics_summary: {
    impressions_change: sproutData.month_comparison?.changes?.impressions?.percent || 0,
    reactions_change: sproutData.month_comparison?.changes?.reactions?.percent || 0,
    link_clicks_change: sproutData.month_comparison?.changes?.link_clicks?.percent || 0,
    video_views_change: sproutData.month_comparison?.changes?.video_views?.percent || 0,
    comments_change: sproutData.month_comparison?.changes?.comments?.percent || 0,
    shares_change: sproutData.month_comparison?.changes?.shares?.percent || 0
  }
};

console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('Generate Run Summary');
console.log(`  Report ID: ${reportId || 'MISSING!'}`);
console.log(`  Status: ${fullReport.status}`);
console.log(`  Period: ${config.current_month_start} to ${config.current_month_end}`);
console.log(`  Geo: [${geoArr.join(', ')}] | Languages: [${languagesArr.join(', ')}]`);
console.log(`  Brand Voice: ${brandVoice || 'none'}`);
console.log(`  Brand Book: ${brandBookText ? 'provided' : 'none'}`);
console.log(`  AI analysis keys: ${Object.keys(aiAnalysis).join(', ') || 'EMPTY'}`);
console.log(`  Calendar posts: ${fullReport.data_counts.total_recommendations}`);
console.log(`  Content Calendar Days: ${fullReport.data_counts.content_calendar_days}`);
console.log(`  TikTok trends: ${fullReport.data_counts.tiktok_trends}`);
console.log(`  Instagram trends: ${fullReport.data_counts.instagram_trends}`);
console.log(`  Sprout top posts: ${fullReport.data_counts.sprout_top_posts}`);
if (presentationUrl) console.log(`  ✅ Gamma URL: ${presentationUrl}`);
else console.log('  ❌ Gamma URL: NONE');
console.log('═══════════════════════════════════════════════════════');

return [{ json: fullReport }];
