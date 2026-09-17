// Combine Brief Context with Client Data - UPDATED: multi-geo, multi-language, brand_voice
// Adds Webhook fallback when $('Workflow Configuration') fails silently

// Get the brief analysis from current input (from "Analyze Client Brief Context")
const briefAnalysis = $input.first().json || {};

// === RESILIENT CLIENT DATA FETCH ===
// Try Workflow Configuration first, then fall back to raw Webhook body
let clientData = {};

// Attempt 1: Workflow Configuration (has date math + webhook body via includeOtherFields)
try {
  const wfConfig = $('Workflow Configuration').first().json;
  // n8n Webhook wraps POST body under "body" key, so client_name is in wfConfig.body.client_name
  const wfBody = wfConfig.body || wfConfig;
  const wfClientName = wfConfig.client_name || wfBody.client_name;
  if (wfConfig && wfClientName) {
    // Merge body fields to top level so downstream code works
    clientData = { ...wfBody, ...wfConfig };
    // Ensure top-level client_name is set
    clientData.client_name = wfClientName;
    console.log('✅ Got client data from Workflow Configuration');
    
    // Get the webhook body for custom date range check
    let whBody = {};
    try {
      const wh = $('Webhook').first().json;
      whBody = wh.body || wh;
    } catch(e) {
      whBody = wfBody;
    }
    
    // ALWAYS compute previous period dynamically based on current period length
    const fmt = (d) => d.toISOString().split('T')[0];
    const currentStart = whBody.date_range_start || clientData.date_range_start || clientData.current_month_start;
    const currentEnd = whBody.date_range_end || clientData.date_range_end || clientData.current_month_end;
    
    if (currentStart && currentEnd) {
      clientData.current_month_start = currentStart;
      clientData.current_month_end = currentEnd;
      const customStartDate = new Date(currentStart);
      const customEndDate = new Date(currentEnd);
      const daysDiff = Math.ceil((customEndDate - customStartDate) / (1000 * 60 * 60 * 24));
      const prevEnd = new Date(customStartDate);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - daysDiff);
      clientData.previous_month_start = fmt(prevStart);
      clientData.previous_month_end = fmt(prevEnd);
      console.log('✅ Dynamic period:', currentStart, 'to', currentEnd, `(${daysDiff} days)`);
      console.log('✅ Previous period:', clientData.previous_month_start, 'to', clientData.previous_month_end);
    }
  }
} catch (e) {
  console.log('⚠️ Workflow Configuration not accessible:', e.message);
}

// Attempt 2: Raw Webhook body (if Workflow Configuration failed or returned empty)
if (!clientData.client_name) {
  try {
    const webhookData = $('Webhook').first().json;
    const body = webhookData.body || webhookData;
    if (body && body.client_name) {
      clientData = { ...body };
      console.log('✅ Got client data from Webhook (fallback)');

      // Manually compute the date fields that Workflow Configuration would have added
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth(); // 0-indexed

      const currentMonthStart = new Date(year, month, 1);
      const currentMonthEnd = now;
      const prevMonthStart = new Date(year, month - 1, 1);
      const prevMonthEnd = new Date(year, month, 0); // Last day of previous month

      const fmt = (d) => d.toISOString().split('T')[0];

      // Use custom date range from Loveable if provided, otherwise use month defaults
      const effectiveStart = (body.date_range_start && body.date_range_start.length > 0) 
        ? body.date_range_start 
        : fmt(currentMonthStart);
      const effectiveEnd = (body.date_range_end && body.date_range_end.length > 0) 
        ? body.date_range_end 
        : fmt(currentMonthEnd);
      
      clientData.current_month_start = effectiveStart;
      clientData.current_month_end = effectiveEnd;
      
      // ALWAYS compute previous period dynamically based on current period length
      const customStartDate = new Date(effectiveStart);
      const customEndDate = new Date(effectiveEnd);
      const daysDiff = Math.ceil((customEndDate - customStartDate) / (1000 * 60 * 60 * 24));
      const prevEndDate = new Date(customStartDate);
      prevEndDate.setDate(prevEndDate.getDate() - 1);
      const prevStartDate = new Date(prevEndDate);
      prevStartDate.setDate(prevStartDate.getDate() - daysDiff);
      clientData.previous_month_start = fmt(prevStartDate);
      clientData.previous_month_end = fmt(prevEndDate);
      
      console.log('✅ Current period:', effectiveStart, 'to', effectiveEnd, '(' + daysDiff + ' days)');
      console.log('✅ Previous period:', clientData.previous_month_start, 'to', clientData.previous_month_end);

      const trendsEnd = new Date(now);
      trendsEnd.setDate(trendsEnd.getDate() - 1);
      const trendsStart = new Date(now);
      trendsStart.setDate(trendsStart.getDate() - 8);
      clientData.trends_start_date = fmt(trendsStart);
      clientData.trends_end_date = fmt(trendsEnd);
    }
  } catch (e2) {
    console.log('❌ Webhook fallback also failed:', e2.message);
  }
}

if (!clientData.client_name) {
  console.log('❌ CRITICAL: No client data found from any source!');
}

let prepared = {};
try { prepared = $('Prepare Brief Text').first().json; } catch (error) {}
clientData.brief_text = prepared.brief_text || clientData.brief_text || '';
const config = clientData;

// Parse content pillars (could be CSV string, array of strings, or array of objects from Loveable)
const contentPillarsRaw = clientData.content_pillars || '';
let contentPillars = [];
if (Array.isArray(contentPillarsRaw)) {
  contentPillars = contentPillarsRaw.map(p => {
    if (typeof p === 'string') return p;
    if (p && typeof p === 'object' && p.name) return p.name;
    return '';
  }).filter(Boolean);
} else if (typeof contentPillarsRaw === 'string' && contentPillarsRaw.trim()) {
  contentPillars = contentPillarsRaw.split(',').map(p => p.trim()).filter(Boolean);
}

// Preserve full pillar objects (with descriptions) for richer AI context
let contentPillarsFull = [];
if (Array.isArray(clientData.content_pillars)) {
  contentPillarsFull = clientData.content_pillars.map(p => {
    if (typeof p === 'string') return { name: p, description: '' };
    if (p && typeof p === 'object') return { name: p.name || '', description: p.description || '' };
    return null;
  }).filter(Boolean);
}

// Parse social keywords
const socialKeywordsRaw = clientData.social_keywords || '';
const socialKeywords = Array.isArray(socialKeywordsRaw)
  ? socialKeywordsRaw
  : (typeof socialKeywordsRaw === 'string'
    ? socialKeywordsRaw.split(',').map(k => k.trim()).filter(Boolean)
    : []);

// Parse trends keywords
const trendsKeywordsRaw = clientData.trends_keywords || '';
const trendsKeywords = typeof trendsKeywordsRaw === 'string'
  ? trendsKeywordsRaw.trim()
  : (Array.isArray(trendsKeywordsRaw) ? trendsKeywordsRaw.join(', ') : '');

// Parse profile_ids
let profileIds = clientData.profile_ids || [];
if (typeof profileIds === 'string') {
  profileIds = profileIds.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
}

// Get profiles array from webhook
const profiles = clientData.profiles || [];

// === MULTI-GEO: handle as array ===
let geoArr = clientData.geo || ['US'];
if (typeof geoArr === 'string') {
  geoArr = geoArr.split(',').map(s => s.trim()).filter(Boolean);
}
if (!Array.isArray(geoArr)) geoArr = [geoArr];
if (geoArr.length === 0) geoArr = ['US'];

// === MULTI-LANGUAGE: handle as array ===
let languagesArr = clientData.languages || clientData.language || ['en'];
if (typeof languagesArr === 'string') {
  languagesArr = languagesArr.split(',').map(s => s.trim()).filter(Boolean);
}
if (!Array.isArray(languagesArr)) languagesArr = [languagesArr];
if (languagesArr.length === 0) languagesArr = ['en'];

// === BRAND VOICE ===
const brandVoice = clientData.brand_voice || '';

// === BRAND BOOK ===
const brandBookText = clientData.brand_book_text || '';

// === BRIEF CONTEXT HANDLING ===
// If AI brief analysis failed (empty object), use brief_text from webhook as fallback
let briefContext = {
  brand_voice: null,
  target_audience: null,
  content_themes: [],
  brand_values: [],
  competitive_positioning: null,
  content_restrictions: [],
  campaign_objectives: null
};

const analyzed = briefAnalysis.output || briefAnalysis;
const hasBriefAnalysis = ['brand_voice', 'target_audience', 'content_themes', 'brand_values', 'competitive_positioning', 'content_restrictions', 'campaign_objectives'].some(key =>
  Array.isArray(analyzed[key]) ? analyzed[key].length > 0 : typeof analyzed[key] === 'string' && analyzed[key].trim().length > 0
);
const briefWarning = prepared.brief_warning || (!hasBriefAnalysis && clientData.brief_text ? 'The brief could not be summarized; its original text was included in the analysis.' : '');

if (hasBriefAnalysis) {
  // Use the AI-analyzed brief context
  briefContext = {
    brand_voice: briefAnalysis.output?.brand_voice || briefAnalysis.brand_voice || null,
    target_audience: briefAnalysis.output?.target_audience || briefAnalysis.target_audience || null,
    content_themes: briefAnalysis.output?.content_themes || briefAnalysis.content_themes || [],
    brand_values: briefAnalysis.output?.brand_values || briefAnalysis.brand_values || [],
    competitive_positioning: briefAnalysis.output?.competitive_positioning || briefAnalysis.competitive_positioning || null,
    content_restrictions: briefAnalysis.output?.content_restrictions || briefAnalysis.content_restrictions || [],
    campaign_objectives: briefAnalysis.output?.campaign_objectives || briefAnalysis.campaign_objectives || null
  };
  console.log('✅ Using AI-analyzed brief context');
} else if (clientData.brief_text && clientData.brief_text.trim()) {
  // Fallback: use raw brief_text from Loveable as unstructured context
  briefContext = {
    brand_voice: null,
    target_audience: null,
    content_themes: [],
    brand_values: [],
    competitive_positioning: null,
    content_restrictions: [],
    campaign_objectives: null,
    raw_brief: clientData.brief_text
  };
  console.log('⚠️ Using raw brief_text as fallback (AI analysis failed)');
} else {
  console.log('⚠️ No brief context available (no brief_file_id and no brief_text)');
}

console.log('═══════════════════════════════════════════════════════════');
console.log('Combining Brief Context with Client Data');
console.log(`  Client: ${clientData.client_name || 'Unknown'}`);
console.log(`  Sprout Customer ID: ${clientData.sprout_customer_id || 'MISSING'}`);
console.log(`  Report ID: ${clientData.report_id || 'MISSING'}`);
console.log(`  Profile IDs: [${profileIds.join(', ')}]`);
console.log(`  Profiles: ${profiles.length}`);
console.log(`  Social keywords: [${socialKeywords.join(', ')}]`);
console.log(`  Content pillars: [${contentPillars.join(', ')}]`);
console.log(`  Geo (array): [${geoArr.join(', ')}]`);
console.log(`  Languages (array): [${languagesArr.join(', ')}]`);
console.log(`  Brand Voice: ${brandVoice || 'none'}`);
console.log(`  Brand Book: ${brandBookText ? brandBookText.substring(0, 50) + '...' : 'none'}`);
console.log(`  Brief source: ${hasBriefAnalysis ? 'AI analysis' : (clientData.brief_text ? 'raw text' : 'none')}`);
console.log('═══════════════════════════════════════════════════════════');

// Merge the data
return [{
  json: {
    // Identifiers
    report_id: clientData.report_id || '',

    // Client info from webhook
    client_name: clientData.client_name || '',
    sprout_customer_id: clientData.sprout_customer_id || '',
    profile_ids: profileIds,
    profiles: profiles,
    keywords: clientData.keywords || '',
    social_keywords: socialKeywords,
    trends_keywords: trendsKeywords,
    primary_platforms: clientData.primary_platforms || 'Instagram,TikTok,Facebook',
    geo: geoArr,
    languages: languagesArr,
    timezone: clientData.timezone || 'UTC',
    brand_voice: brandVoice,
    brand_book_text: brandBookText,
    brand_notes: clientData.brand_notes || '',
    brief_file_id: clientData.brief_file_id || '',
    brief_text: clientData.brief_text || '',

    // Content Pillars
    content_pillars: contentPillars,
    content_pillars_full: contentPillarsFull,

    // Date ranges
    date_ranges: {
      current_month: {
        start: config.current_month_start,
        end: config.current_month_end
      },
      previous_month: {
        start: config.previous_month_start,
        end: config.previous_month_end
      }
    },

    // Skip trends flag
    skip_trends: !!(clientData.skip_trends),

    // Brief analysis
    brief_context: briefContext,
    brief_warning: briefWarning,

    // Design language (Phase 9) - pass through from webhook for downstream normalization
    design_style_synthesis: clientData.design_style_synthesis || null,
    design_references: clientData.design_references || [],
    brand_book_file_path: clientData.brand_book_file_path || null
  }
}];
