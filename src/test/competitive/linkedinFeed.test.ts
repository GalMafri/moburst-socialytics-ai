// @vitest-environment node
import {afterEach, expect, it, vi} from 'vitest';
import {collectLinkedInSource, selectedFeedSources} from '../../../supabase/functions/_shared/competitive/linkedinSource';
const companies=[{id:1,name:'Client',url:'https://client.test'},{id:2,name:'Peer',url:'https://peer.test'},{id:3,name:'Unselected',url:'https://other.test'}];
const peers=[{name:'Peer',website_url:'https://peer.test',competitor_handles:[{platform:'linkedin',handle:'peer',is_active:true}]}];
const own=[{network_type:'linkedin_company',native_link:'',native_name:'client'}];
const period={start:'2026-09-22',end:'2026-09-28'};
const endpoint='https://moburst.app.n8n.cloud/webhook/socialytics-linkedin-source';
afterEach(()=>vi.unstubAllGlobals());
it('uses only confirmed companies and connected own profiles',()=>{
 const plan=selectedFeedSources(companies,'1',peers,own);
 expect(plan.companyIds).toEqual(['1','2']);
 expect(plan.sources.map(s=>s.profile_url)).toEqual(['https://www.linkedin.com/company/client','https://www.linkedin.com/company/peer']);
});
it('rejects stale landscapes and one profile assigned to multiple companies',()=>{
 expect(()=>selectedFeedSources(companies,'1',[{...peers[0],website_url:'https://unrelated.test'}],own)).toThrow('do not match');
 expect(()=>selectedFeedSources(companies,'1',peers,[{...own[0],native_name:'peer'}])).toThrow('multiple companies');
});
it('does not call a collector when no LinkedIn company profile is selected',async()=>{
 const call=vi.fn();vi.stubGlobal('fetch',call);
 expect(await collectLinkedInSource([],period,'fixture','')).toEqual({socialPosts:[],additional_metrics:{}});expect(call).not.toHaveBeenCalled();
});
it('accepts only complete source coverage for the requested company and dates',async()=>{
 const sources=selectedFeedSources(companies,'1',[],own).sources;
 const result={socialPosts:[{postLink:'https://www.linkedin.com/posts/client-example'}],additional_metrics:{'1':{coverage:'complete',profile_url:sources[0].profile_url,period,posts:1,engagement:2}}};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(result))));
 expect((await collectLinkedInSource(sources,period,'fixture',endpoint)).socialPosts).toHaveLength(1);
 result.additional_metrics['1'].period={start:'2026-08-01',end:'2026-08-31'};
 await expect(collectLinkedInSource(sources,period,'fixture',endpoint)).rejects.toThrow('coverage did not match');
});
it('blocks partial provider responses and untrusted collector endpoints',async()=>{
 const sources=selectedFeedSources(companies,'1',[],own).sources;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:502})));
 await expect(collectLinkedInSource(sources,period,'fixture',endpoint)).rejects.toThrow('previous feed was preserved');
 await expect(collectLinkedInSource(sources,period,'fixture','https://unrelated.test/collect')).rejects.toThrow('not configured');
});
