const cfg = $('Run Config').first().json;
const sourcePlan = $('Prepare LinkedIn Sources').first().json;
const rival = $('Merge Post Pages').first().json;
const profile = value => {
  const m = String(value || '').match(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([a-z0-9_-]+)(?:\/|\?|$)/i);
  return m ? 'https://www.linkedin.com/company/' + m[1].toLowerCase() : '';
};
const rows = sourcePlan.has_sources ? $input.all().map(i=>i.json).filter(j=>Object.keys(j).length) : [];
const byUrl = new Map(sourcePlan.sources.map(s=>[s.profile_url,s]));
const counts = new Map(); const seen = new Set(); const posts = [];
const metrics = Object.fromEntries(sourcePlan.sources.map(s=>[s.company_id,{provider:'apify/harvestapi',profile_url:s.profile_url,period:{start:cfg.range_start,end:cfg.range_end},posts:0,engagement:0,coverage:'complete',reposts_included:false}]));
const previous = sourcePlan.previous_period;
if (previous) for (const m of Object.values(metrics)) m.previous = {period:previous,posts:0,engagement:0,coverage:'complete'};
for (const row of rows) {
  if (row.error || row.type === 'error') throw new Error('LinkedIn collection returned an error; the report must not treat it as zero activity.');
  if (row.type !== 'post') throw new Error('LinkedIn collection returned an unexpected result; source coverage could not be verified.');
  const source = byUrl.get(profile(row.query?.targetUrl));
  if (!source) throw new Error('LinkedIn post query does not match a reviewed company page.');
  const headerMatches = profile(row.header?.imageLink) === source.profile_url;
  const collaboration = headerMatches && /collaborated on this/i.test(row.header?.text || '');
  if (headerMatches && /reposted this/i.test(row.header?.text || '')) continue;
  // LinkedIn resolves numeric company URLs to a vanity slug. The immutable
  // company ID must match exactly; similar names or slugs are not evidence.
  const reviewedId = source.profile_url.match(/\/company\/(\d+)$/)?.[1];
  const sameCompanyId = reviewedId && row.author?.type === 'company'
    && String(row.author.companyId || '') === reviewedId && !!profile(row.author.linkedinUrl);
  if (profile(row.author?.linkedinUrl) !== source.profile_url && !sameCompanyId && !collaboration) throw new Error('LinkedIn post author does not match the reviewed company page.');
  // This is a profile observation at collection time, never a historical
  // follower count at the post's publication date. Ignore abbreviated counts.
  const followers = !collaboration && row.author?.type === 'company' && String(row.author.info || '').match(/^([\d,]+) followers$/);
  if (followers) metrics[source.company_id].audience_snapshot = {followers:Number(followers[1].replaceAll(',','')),as_of:new Date().toISOString().slice(0,10),source:'apify/harvestapi'};
  counts.set(source.profile_url,(counts.get(source.profile_url)||0)+1);
  const published = row.postedAt?.date;
  if (!published || !Number.isFinite(Date.parse(published)) || !/^https:\/\/www\.linkedin\.com\/(?:posts|feed\/update)\//.test(row.linkedinUrl || '')) throw new Error('LinkedIn post is missing its source URL or publication date.');
  const date = new Date(published).toISOString().slice(0,10);
  if (date < (previous?.start || cfg.range_start) || date > cfg.range_end) continue;
  const key = source.company_id + ':' + String(row.id || row.linkedinUrl);
  if (seen.has(key)) continue; seen.add(key);
  const values = ['likes','comments','shares'].map(k=>row.engagement?.[k]);
  if (values.some(n=>typeof n !== 'number' || !Number.isFinite(n) || n<0)) throw new Error('LinkedIn post engagement counts are incomplete.');
  const engagement = values.reduce((sum,n)=>sum+n,0);
  if (date < cfg.range_start) {
    if (previous && date <= previous.end) { metrics[source.company_id].previous.posts++; metrics[source.company_id].previous.engagement += engagement; }
    continue;
  }
  metrics[source.company_id].posts++; metrics[source.company_id].engagement += engagement;
  const image = row.postImages?.[0]?.url || row.document?.coverPages?.[0]?.imageUrls?.[0] || row.postVideo?.thumbnailUrl || row.article?.image?.url || null;
  posts.push({postId:'linkedin:'+key,companyId:source.company_id,companyName:source.name,channel:'linkedin',publishedAt:new Date(published).toISOString(),message:String(row.content||''),postLink:row.linkedinUrl,image,engagementTotal:engagement,applause:values[0],conversation:values[1],amplification:values[2],type:row.document?'carousel':row.postVideo?'video':row.article?'link':image?'image':'text',source:'apify/harvestapi',source_profile_url:source.profile_url,authorship:collaboration?'collaboration':'company'});
}
if ([...counts.values()].some(n=>n>=150)) throw new Error('LinkedIn collection reached its per-company limit; this period needs a larger paginated retrieval.');
return [{json:{...rival,socialPosts:[...(rival.socialPosts||[]),...posts],additional_metrics:metrics,linkedin_sources:sourcePlan.sources,linkedin_posts:posts.length}}];
