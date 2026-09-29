const cfg = $('Run Config').first().json;
const body = $('Competitive Webhook').first().json.body || {};
const landscape = $('Resolve Landscape').first().json;
const profile = value => {
  const raw = String(value || '').trim();
  const match = raw.match(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([a-z0-9_-]+)(?:\/|\?|$)/i);
  return match ? 'https://www.linkedin.com/company/' + match[1].toLowerCase() : '';
};
const host = value => String(value || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
const sources = [];
const add = (company, handles) => {
  const urls = [...new Set((handles || []).filter(h => ['linkedin','linkedin_company'].includes(h.platform || h.network_type)).map(h => profile(h.url || h.native_link) || (/^[a-z0-9_-]+$/i.test(h.handle || '') ? profile('https://www.linkedin.com/company/' + h.handle) : '')).filter(Boolean))];
  if (urls.length > 1) throw new Error(company.name + ' has multiple reviewed LinkedIn company pages. Choose one primary profile.');
  if (urls.length === 1) sources.push({company_id:String(company.id),name:company.name,profile_url:urls[0]});
};
const own = landscape.companies.find(c => String(c.id) === String(landscape.client_company_id));
if (own) add(own, body.client_profiles || []);
for (const selected of body.competitors || []) {
  const company = landscape.companies.find(c => host(c.url) === host(selected.website_url));
  if (!company) throw new Error('LinkedIn source company is not in the verified selection.');
  add(company, selected.handles);
}
if (new Set(sources.map(s => s.profile_url)).size !== sources.length) throw new Error('The same LinkedIn page is assigned to different companies.');
return [{json:{sources,has_sources:sources.length>0,input:{targetUrls:sources.map(s=>s.profile_url),maxPosts:150,postedLimitDate:cfg.range_start,scrapeComments:false,scrapeReactions:false,includeReposts:false,includeQuotePosts:true}}}];
