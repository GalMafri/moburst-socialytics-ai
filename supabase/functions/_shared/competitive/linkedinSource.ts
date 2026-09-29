import { matchingClientCompanies } from './rivaliqLandscape.ts';

export type LinkedInSource = {company_id: string; name: string; profile_url: string};
export function linkedInProfile(value: unknown): string {
  const match = String(value || '').trim().match(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([a-z0-9_-]+)(?:\/|\?|$)/i);
  return match ? 'https://www.linkedin.com/company/' + match[1].toLowerCase() : '';
}

export function selectedFeedSources(companies: any[], clientCompanyId: string, competitors: any[], ownProfiles: any[]) {
  const sources: LinkedInSource[] = [];
  const ids = new Set([String(clientCompanyId)]);
  const add = (company: any, profiles: any[]) => {
    const urls = [...new Set(profiles.filter(p => ['linkedin','linkedin_company'].includes(p.platform || p.network_type)).map(p =>
      linkedInProfile(p.profile_url || p.native_link) || (/^[a-z0-9_-]+$/i.test(p.handle || p.native_name || '') ? linkedInProfile('https://www.linkedin.com/company/' + (p.handle || p.native_name)) : '')
    ).filter(Boolean))];
    if (urls.length > 1) throw new Error(company.name + ' has multiple LinkedIn company pages. Choose one primary profile.');
    if (urls.length) sources.push({company_id:String(company.id),name:company.name,profile_url:urls[0]});
  };
  const own = companies.find(c=>String(c.id)===String(clientCompanyId));
  if (own) add(own, ownProfiles);
  for (const c of competitors) {
    const matches = matchingClientCompanies(companies, c.name, c.website_url);
    if (matches.length !== 1 || ids.has(String(matches[0].id))) throw new Error('The selected competitors do not match the connected landscape. Review tracking first.');
    ids.add(String(matches[0].id));
    add(matches[0], (c.competitor_handles || []).filter((p:any)=>p.is_active === true));
  }
  if (new Set(sources.map(s=>s.profile_url)).size !== sources.length) throw new Error('One LinkedIn page is assigned to multiple companies.');
  return {sources, companyIds: [...ids]};
}

export async function collectLinkedInSource(sources: LinkedInSource[], period: {start:string;end:string}, secret: string, endpoint: string) {
  if (!sources.length) return {socialPosts:[], additional_metrics:{}};
  const url = new URL(endpoint);
  if (url.origin !== 'https://moburst.app.n8n.cloud' || url.pathname !== '/webhook/socialytics-linkedin-source') throw new Error('LinkedIn collection endpoint is not configured.');
  const response = await fetch(url, {
    method:'POST', headers:{'Content-Type':'application/json','X-Socialytics-Secret':secret},
    body:JSON.stringify({sources,period}), signal:AbortSignal.timeout(100000),
  });
  if (!response.ok) throw new Error('LinkedIn source collection failed ['+response.status+']. The previous feed was preserved.');
  const result = await response.json();
  if (!Array.isArray(result.socialPosts) || !result.additional_metrics) throw new Error('LinkedIn source response was incomplete.');
  for (const s of sources) {
    const m = result.additional_metrics[s.company_id];
    if (m?.coverage !== 'complete' || m.profile_url !== s.profile_url || m.period?.start !== period.start || m.period?.end !== period.end) throw new Error('LinkedIn source coverage did not match the requested feed.');
  }
  return result;
}
