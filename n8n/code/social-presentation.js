// Build Gamma Presentation Content - COMPREHENSIVE VERSION
// Includes full post captions, Sprout top posts, and detailed evidence

const reportData = $('Format Report Content').first().json;
const clientData = $('Build Normalized Client Object').first().json;

let aiOutput = {};
try {
  const aiResult = $('AI Synthesis Agent').first().json;
  aiOutput = aiResult.output || aiResult;
} catch (e) { console.log('Could not get AI output:', e.message); }

const clientName = clientData.client_name || 'Client';
const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// Extract all data
const momComparison = clientData.sprout?.month_comparison || {};
const changes = momComparison.changes || {};
const momSummary = momComparison.summary || [];
const sproutTopPosts = clientData.sprout?.top_posts || [];
const overallTotals = clientData.sprout?.overall_totals || {};
const platformBreakdown = clientData.sprout?.platform_breakdown || [];
const topPostsByPlatform = clientData.sprout?.top_posts_by_platform || {};

// Build the platform-by-platform performance slide (only when data exists)
let platformBreakdownBlock = '';
if (Array.isArray(platformBreakdown) && platformBreakdown.length > 0) {
  const pctStr = (ch, k) => {
    const v = ch && ch[k] && typeof ch[k].percent === 'number' ? ch[k].percent : null;
    if (v === null) return '';
    return ' (' + (v > 0 ? '+' : '') + v + '% MoM)';
  };
  let body = 'Profile activity within the exact report dates, compared with the preceding equal-length period:\n\n';
  platformBreakdown.forEach(p => {
    const c = p.current || {};
    const ch = p.changes || {};
    body += '▸ ' + (p.network || 'Platform').toUpperCase() + ' — ' + (p.post_count || 0) + ' posts\n';
    body += '   Impressions: ' + (c.impressions || 0).toLocaleString() + pctStr(ch, 'impressions') + '\n';
    body += '   Reactions: ' + (c.reactions || 0).toLocaleString() + pctStr(ch, 'reactions') + '   |   Comments: ' + (c.comments || 0).toLocaleString() + pctStr(ch, 'comments') + '   |   Shares: ' + (c.shares || 0).toLocaleString() + pctStr(ch, 'shares') + '\n';
    body += '   Link Clicks: ' + (c.link_clicks || 0).toLocaleString() + pctStr(ch, 'link_clicks') + '   |   Video Views: ' + (c.video_views || 0).toLocaleString() + pctStr(ch, 'video_views') + '\n\n';
  });
  platformBreakdownBlock = '\n\n---\n\nSLIDE 3B: PLATFORM-BY-PLATFORM PERFORMANCE\n\n' + body + 'Visualize as a comparison table or grouped bar chart — one row/group per platform.';
}

const tiktokPosts = clientData.trends?.tiktok?.posts || [];
const tiktokPatterns = clientData.trends?.tiktok?.patterns || {};
const instagramPosts = clientData.trends?.instagram?.posts || [];
const instagramPatterns = clientData.trends?.instagram?.patterns || {};
const contentPillars = clientData.context?.content_pillars || [];

const sproutAnalysis = aiOutput.sprout_performance_analysis || {};
const tiktokAnalysis = aiOutput.tiktok_trends_analysis || {};
const igAnalysis = aiOutput.instagram_trends_analysis || {};

// Helper: Truncate text but keep it meaningful
function truncate(text, maxLen = 200) {
  if (!text) return '';
  const clean = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen) + '...';
}

// Helper: Format engagement metrics
function formatMetrics(post, platform) {
  if (platform === 'tiktok') {
    return `Views: ${(post.views || 0).toLocaleString()} | Likes: ${(post.likes || 0).toLocaleString()} | Comments: ${(post.comments || 0).toLocaleString()} | Shares: ${(post.shares || 0).toLocaleString()}`;
  } else {
    return `Likes: ${(post.likes || 0).toLocaleString()} | Comments: ${(post.comments || 0).toLocaleString()}`;
  }
}

// Count posts by platform from calendar
const contentCalendar = aiOutput.content_calendar || [];
const platformCounts = {};
contentCalendar.forEach(day => {
  (day.posts || []).forEach(post => {
    const platform = post.platform || 'Other';
    platformCounts[platform] = (platformCounts[platform] || 0) + 1;
  });
});

// Determine key insight based on actual data
let keyInsight = '';
if (changes.impressions?.percent < -50) {
  keyInsight = `Significant performance decline across all metrics requires immediate attention. Content volume dropped from ${momComparison.previous_month?.post_count || 'higher'} to ${momComparison.current_month?.post_count || 'fewer'} posts, directly impacting reach.`;
} else if (changes.impressions?.percent > 20) {
  keyInsight = `Strong growth momentum with ${changes.impressions?.percent}% increase in impressions. Top performing content themes should be expanded.`;
} else {
  keyInsight = sproutAnalysis.month_over_month_summary || 'See detailed analysis below.';
}

// ============================================
// BUILD COMPREHENSIVE GAMMA PROMPT
// ============================================
let prompt = `Create a professional Social Media Performance & Trend Analysis Report for ${clientName}.

DESIGN INSTRUCTIONS:
- Visually engaging executive presentation with modern, clean design
- Use charts/graphs for all metrics sections
- Each major section should be its own slide or slide group
- Highlight key numbers, percentages, and quotes prominently
- Include clickable links where URLs are provided
- Use brand colors if known, otherwise professional blue/gray palette

CRITICAL CONTENT RULES (follow exactly - do not deviate):
- This report contains TWO distinct kinds of posts. NEVER mix them:
  1. CLIENT OWN POSTS = posts published by ${clientName}'s OWN social accounts (their own results).
  2. TRENDING INDUSTRY POSTS = external, third-party posts from OTHER accounts, shown only as market/trend reference.
- The slide titled ${clientName}'S OWN TOP PERFORMING POSTS must use ONLY the posts listed in that section. Never replace, supplement, merge, or re-rank them with trending or industry posts.
- Replace any existing sample or placeholder posts in the template with the exact posts provided here; never keep template example posts.
- Reproduce every performance number and date EXACTLY from the supplied tables. Do not recalculate, estimate, or combine lifetime post metrics with period profile totals. Label Facebook/Instagram impressions as views and LinkedIn clicks as all post clicks. Reproduce every post account/handle, metrics, caption text and URL EXACTLY as written. Do not invent, swap, summarize away, or reorder posts. Keep the given order.

---

SLIDE 1: TITLE

${clientName}
Weekly Social Performance & Trend Analysis
${date}

---

SLIDE 2: EXECUTIVE SUMMARY

REPORT PERIOD: ${clientData.report_window?.current_month?.start || 'Current Month'} to ${clientData.report_window?.current_month?.end || 'Present'}

KEY METRICS AT A GLANCE:
`;

// Add metrics with visual indicators
momSummary.forEach(metric => {
  prompt += `• ${metric}\n`;
});

prompt += `
⚡ KEY INSIGHT: ${keyInsight}

PLATFORMS ANALYZED: ${clientData.context?.primary_platforms?.join(', ') || 'LinkedIn, Instagram, Facebook'}
CONTENT PILLARS: ${contentPillars.slice(0, 4).join(', ') || 'See pillar analysis'}

---

SLIDE 3: PERFORMANCE DASHBOARD

MONTH-OVER-MONTH COMPARISON (Visualize as bar chart or gauge):

`;

Object.entries(changes).forEach(([metric, data]) => {
  if (data && typeof data.percent === 'number') {
    const arrow = data.percent > 0 ? '↑' : (data.percent < 0 ? '↓' : '→');
    const emoji = data.percent > 20 ? '🟢' : (data.percent > 0 ? '🟡' : (data.percent < -20 ? '🔴' : '⚪'));
    const change = data.absolute >= 0 ? `+${data.absolute.toLocaleString()}` : data.absolute.toLocaleString();
    prompt += `${emoji} ${metric.replace(/_/g, ' ').toUpperCase()}: ${arrow} ${Math.abs(data.percent)}% (${change})\n`;
  }
});

prompt += `
CURRENT PERIOD TOTALS:
• Total Impressions: ${(overallTotals.impressions || 0).toLocaleString()}
• Total Reactions: ${(overallTotals.reactions || 0).toLocaleString()}
• Period Engagements: ${(overallTotals.engagements || 0).toLocaleString()}
• Period Comments: ${(overallTotals.comments || 0).toLocaleString()}
• Period Shares: ${(overallTotals.shares || 0).toLocaleString()}
• Total Link Clicks: ${(overallTotals.link_clicks || 0).toLocaleString()}
• Total Video Views: ${(overallTotals.video_views || 0).toLocaleString()}${platformBreakdownBlock}

---

SLIDE 4: PERFORMANCE INSIGHTS

KEY FINDINGS:
`;

(sproutAnalysis.key_insights || ['Analysis pending']).forEach((insight, i) => {
  prompt += `${i + 1}. ${insight}\n\n`;
});

// ============================================
// SPROUT SOCIAL TOP POSTS (CLIENT'S OWN CONTENT)
// ============================================
prompt += `
---

SLIDE 5: ${clientName}'S OWN TOP PERFORMING POSTS (CLIENT ACCOUNTS)

These are ${clientName}'s OWN best-performing posts from their OWN social accounts this period. Reproduce these EXACT posts, in this EXACT order. Do NOT replace or supplement them with the trending or industry posts shown on later slides:

`;

const tppKeys = Object.keys(topPostsByPlatform || {});
if (tppKeys.length > 0) {
  tppKeys.forEach(network => {
    const posts = topPostsByPlatform[network] || [];
    if (!posts.length) return;
    prompt += `\n● ${network.toUpperCase()} — TOP POSTS\n`;
    posts.slice(0, 3).forEach((post, i) => {
      const metrics = `Lifetime metrics (not period totals). Impressions: ${(post.impressions || 0).toLocaleString()} | Reactions: ${(post.reactions || 0).toLocaleString()} | Comments: ${(post.comments || 0).toLocaleString()} | Shares: ${(post.shares || 0).toLocaleString()} | Clicks: ${(post.link_clicks || 0).toLocaleString()}`;
      const postText = truncate(post.text || post.message || post.content || 'No text available', 250);
      prompt += `\n📌 ${network.toUpperCase()} CLIENT POST ${i + 1}\n${metrics}\n"${postText}"\n${post.permalink || post.url || ''}\n`;
    });
  });
} else if (sproutTopPosts.length > 0) {
  sproutTopPosts.slice(0, 5).forEach((post, i) => {
    const platform = post.network_type || post.platform || 'Social';
    const metrics = `Lifetime metrics (not period totals). Impressions: ${(post.impressions || 0).toLocaleString()} | Reactions: ${(post.reactions || 0).toLocaleString()} | Clicks: ${(post.link_clicks || 0).toLocaleString()}`;
    const postText = truncate(post.text || post.message || post.content || 'No text available', 250);
    prompt += `\n📌 CLIENT OWN POST ${i + 1} [${platform.toUpperCase()}]\n${metrics}\n"${postText}"\n${post.permalink || post.url || ''}\n\n`;
  });
} else {
  prompt += `No top posts data available for this period. This may indicate limited posting activity.\n`;
}

// ============================================
// CONTENT PILLAR ANALYSIS
// ============================================
prompt += `
---

SLIDE 6: CONTENT PILLAR ANALYSIS

DEFINED PILLARS: ${contentPillars.join(' | ') || 'Not specified'}

✅ WELL-REPRESENTED IN CURRENT CONTENT:
`;

(sproutAnalysis.pillar_alignment?.well_represented || ['See detailed analysis']).forEach(p => {
  prompt += `• ${p}\n`;
});

prompt += `
⚠️ UNDERREPRESENTED (OPPORTUNITY AREAS):
`;

(sproutAnalysis.pillar_alignment?.underrepresented || ['See detailed analysis']).forEach(p => {
  prompt += `• ${p}\n`;
});

prompt += `
💡 PILLAR RECOMMENDATIONS:
`;

(sproutAnalysis.pillar_alignment?.recommendations || []).slice(0, 3).forEach((rec, i) => {
  prompt += `${i + 1}. ${rec}\n`;
});

// ============================================
// TIKTOK TRENDS - WITH FULL POST DATA (CONDITIONAL)
// ============================================
const hasTikTokData = tiktokPosts.length > 0 || (tiktokAnalysis.overview && tiktokAnalysis.overview !== 'No analysis available.');
const hasInstagramData = instagramPosts.length > 0 || (igAnalysis.overview && igAnalysis.overview !== 'No analysis available.');
const skipTrends = clientData.skip_trends || (!hasTikTokData && !hasInstagramData);

let slideNum = 7;

if (hasTikTokData) {
prompt += `
---

SLIDE ${slideNum}: TIKTOK TRENDS OVERVIEW

${tiktokAnalysis.overview || 'Analysis of top-performing TikTok content in your industry keywords.'}

🔥 TOP THEMES IDENTIFIED:
`;

(tiktokAnalysis.top_themes || []).forEach(theme => {
  prompt += `• ${theme}\n`;
});

prompt += `
📹 SUCCESSFUL CONTENT FORMATS:
`;

(tiktokAnalysis.successful_formats || []).forEach(format => {
  prompt += `• ${format}\n`;
});

prompt += `
#️⃣ TRENDING HASHTAGS: ${(tiktokPatterns.top_hashtags || []).slice(0, 8).map(h => `#${h.tag}`).join('  ') || 'See individual posts'}

---

SLIDE ${slideNum + 1}: TRENDING TIKTOK CONTENT IN YOUR INDUSTRY (EXTERNAL ACCOUNTS - NOT ${clientName}'S POSTS)

These are external, third-party TikTok posts from OTHER accounts in your industry, shown for trend reference only. They are NOT ${clientName}'s posts and must never appear on the client's own top-posts slide. Study their hooks and copy:

`;

tiktokPosts.slice(0, 7).forEach((post, i) => {
  const caption = truncate(post.caption, 300);
  prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 TRENDING TIKTOK #${i + 1} (EXTERNAL ACCOUNT): @${post.author}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENGAGEMENT SCORE: ${post.engagement_score?.toLocaleString() || 'N/A'}
${formatMetrics(post, 'tiktok')}

CAPTION/COPY:
"${caption}"

HASHTAGS: ${(post.hashtags || []).slice(0, 5).map(h => `#${h}`).join(' ') || 'None'}

🔗 ${post.url}

`;
});

prompt += `
💡 KEY TIKTOK TAKEAWAYS:
`;

(tiktokAnalysis.key_takeaways || []).forEach((takeaway, i) => {
  prompt += `${i + 1}. ${takeaway}\n`;
});

slideNum += 2;
} // end hasTikTokData

// ============================================
// INSTAGRAM TRENDS - WITH FULL POST DATA (CONDITIONAL)
// ============================================
if (hasInstagramData) {
prompt += `
---

SLIDE ${slideNum}: INSTAGRAM TRENDS OVERVIEW

${igAnalysis.overview || 'Analysis of top-performing Instagram content in your industry keywords.'}

🔥 TOP THEMES IDENTIFIED:
`;

(igAnalysis.top_themes || []).forEach(theme => {
  prompt += `• ${theme}\n`;
});

prompt += `
📸 SUCCESSFUL CONTENT FORMATS:
`;

(igAnalysis.successful_formats || []).forEach(format => {
  prompt += `• ${format}\n`;
});

prompt += `
#️⃣ TRENDING HASHTAGS: ${(instagramPatterns.top_hashtags || []).slice(0, 8).map(h => `#${h.tag}`).join('  ') || 'See individual posts'}

---

SLIDE ${slideNum + 1}: TRENDING INSTAGRAM CONTENT IN YOUR INDUSTRY (EXTERNAL ACCOUNTS - NOT ${clientName}'S POSTS)

These are external, third-party Instagram posts from OTHER accounts in your industry, shown for trend reference only. They are NOT ${clientName}'s posts and must never appear on the client's own top-posts slide. Study their hooks and copy:

`;

instagramPosts.slice(0, 7).forEach((post, i) => {
  const caption = truncate(post.caption, 300);
  prompt += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📷 TRENDING INSTAGRAM #${i + 1} (EXTERNAL ACCOUNT): @${post.author}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENGAGEMENT SCORE: ${post.engagement_score?.toLocaleString() || 'N/A'}
${formatMetrics(post, 'instagram')}
TYPE: ${post.type || 'Post'}

CAPTION/COPY:
"${caption}"

HASHTAGS: ${(post.hashtags || []).slice(0, 5).map(h => `#${h}`).join(' ') || 'None'}

🔗 ${post.url}

`;
});

prompt += `
💡 KEY INSTAGRAM TAKEAWAYS:
`;

(igAnalysis.key_takeaways || []).forEach((takeaway, i) => {
  prompt += `${i + 1}. ${takeaway}\n`;
});

slideNum += 2;
} // end hasInstagramData

if (skipTrends) {
  prompt += `\n---\n\nSLIDE ${slideNum}: TREND ANALYSIS\n\nTrend analysis was not included in this report. This may be because:\n- No social keywords were configured for this client\n- Trend analysis was explicitly skipped for this run\n\nTo enable trend analysis, add social keywords in the client onboarding screen.\n`;
  slideNum++;
}

// ============================================
// WEEKLY CONTENT CALENDAR
// ============================================
const totalCalendarPosts = contentCalendar.reduce((sum, day) => sum + (day.posts || []).length, 0);
prompt += `
---

SLIDE ${slideNum}: WEEKLY CONTENT CALENDAR

A 7-day content plan with ${totalCalendarPosts} posts based on your performance data and trending content analysis.

PLATFORM DISTRIBUTION: ${Object.entries(platformCounts).map(([p, c]) => `${p} (${c})`).join(' | ')}

`;

contentCalendar.forEach((day, dayIdx) => {
  prompt += `
═══════════════════════════════════
📅 ${day.day.toUpperCase()}${day.date_label ? ' (' + day.date_label + ')' : ''}
═══════════════════════════════════
`;
  
  (day.posts || []).forEach((post, i) => {
    prompt += `
${i + 1}. ${(post.platform || 'Social').toUpperCase()} - ${(post.format || 'Post').toUpperCase()}${post.language ? ' [' + post.language.toUpperCase() + ']' : ''}
   🏷️ PILLAR: ${post.pillar || 'General'}
   🌐 LANGUAGE: ${post.language || 'en'}
   ⏰ POSTING TIME: ${post.posting_time || 'Flexible'}
   
   📝 COPY:
   "${truncate(post.copy, 300)}"
   
   #️⃣ HASHTAGS: ${(post.hashtags || []).map(h => '#' + h).join(' ') || 'None'}
   
   🎨 VISUAL DIRECTION: ${post.visual_direction || 'See AI visual prompt'}
   
   🖼️ AI VISUAL PROMPT (Ready to paste into DALL-E/Midjourney):
   "${truncate(post.ai_visual_prompt, 400)}"
   
   💡 RATIONALE: ${post.rationale || ''}

`;
  });
});

// ============================================
// ACTION ITEMS
// ============================================
prompt += `
---

SLIDE ${slideNum + 1}: ACTION ITEMS & NEXT STEPS

🚨 IMMEDIATE PRIORITIES (This Week):
• Implement top 3 content recommendations
• Address performance decline with increased posting frequency
• Focus on underrepresented pillar: ${sproutAnalysis.pillar_alignment?.underrepresented?.[0] || 'Client Wins'}
• Test hooks inspired by top-performing TikTok content

📅 CONTENT CALENDAR RECOMMENDATIONS:
• LinkedIn: ${platformCounts['LinkedIn'] || 0} posts/week
• Instagram: ${platformCounts['Instagram'] || 0} posts/week
• Facebook: ${platformCounts['Facebook'] || 0} posts/week
• TikTok: ${platformCounts['TikTok'] || 0} posts/week

📈 METRICS TO PRIORITIZE:
`;

// Highlight declining metrics
Object.entries(changes).forEach(([metric, data]) => {
  if (data && data.percent < -20) {
    prompt += `• ${metric.replace(/_/g, ' ')}: Currently ${data.percent}% - prioritize improvement\n`;
  }
});

prompt += `
🎯 SUCCESS CRITERIA FOR NEXT REPORT:
• Increase posting frequency by 50%+
• Achieve engagement rate improvement on key pillars
• Test at least 3 new content formats from trend analysis

---

SLIDE ${slideNum + 2}: DATA SOURCES & METHODOLOGY

📊 DATA SOURCES:
• Sprout Social API - ${sproutTopPosts.length} top posts analyzed, full performance metrics
• TikTok Trend Scraper - ${tiktokPosts.length} top posts by engagement (filtered by target languages)
• Instagram Trend Scraper - ${instagramPosts.length} top posts by engagement (filtered by target languages)

🔍 METHODOLOGY:
• Engagement Scoring: (likes × 1) + (comments × 2) + (shares × 3) + (views ÷ 1000)
• Language Filter: Target language content for relevance (multi-language supported)
• Performance dates: ${clientData.report_window?.current_month?.start} to ${clientData.report_window?.current_month?.end}. Top-post metrics are lifetime values for posts published in those dates; they are not period totals.
• Hashtags Searched: ${clientData.context?.brief_context?.social_keywords?.join(', ') || 'Industry-relevant keywords'}

📅 REPORT GENERATED: ${date}

---

END OF PRESENTATION
`;

console.log('Generated comprehensive presentation');
console.log(`- Sprout top posts: ${sproutTopPosts.length}`);
console.log(`- TikTok posts with captions: ${tiktokPosts.length}`);
console.log(`- Instagram posts with captions: ${instagramPosts.length}`);
console.log(`- Calendar posts: ${totalCalendarPosts}`);
console.log(`- Prompt length: ${prompt.length} characters`);

return [{
  json: {
    presentation_content: prompt,
    client_name: clientName,
    report_date: new Date().toISOString().split('T')[0],
    total_recommendations: totalCalendarPosts,
    metrics_summary: {
      impressions_change: changes.impressions?.percent || 0,
      reactions_change: changes.reactions?.percent || 0,
      link_clicks_change: changes.link_clicks?.percent || 0,
      video_views_change: changes.video_views?.percent || 0
    },
    data_included: {
      sprout_top_posts: sproutTopPosts.length,
      tiktok_posts_with_captions: tiktokPosts.length,
      instagram_posts_with_captions: instagramPosts.length,
      content_pillars: contentPillars.length
    },
    trends_count: {
      tiktok: tiktokPosts.length,
      instagram: instagramPosts.length
    }
  }
}];