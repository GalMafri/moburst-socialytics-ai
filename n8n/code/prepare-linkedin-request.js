const body = $input.first().json.body || {};
const period = body.period || {};
const start = Date.parse(period.start + 'T00:00:00Z');
const end = Date.parse(period.end + 'T00:00:00Z');
if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end-start > 365*86400000) throw new Error('Invalid LinkedIn source period.');
const sources = body.sources;
if (!Array.isArray(sources) || !sources.length || sources.length > 10 || sources.some(s=>!s.company_id || !/^https:\/\/www\.linkedin\.com\/company\/[a-z0-9_-]+$/.test(s.profile_url || ''))) throw new Error('Verified LinkedIn company sources are required.');
if (new Set(sources.map(s=>s.profile_url)).size !== sources.length || new Set(sources.map(s=>s.company_id)).size !== sources.length) throw new Error('Duplicate LinkedIn source identities.');
return [{json:{range_start:period.start,range_end:period.end,sources,has_sources:true,input:{targetUrls:sources.map(s=>s.profile_url),maxPosts:150,postedLimitDate:period.start,scrapeComments:false,scrapeReactions:false,includeReposts:false,includeQuotePosts:true}}}];
