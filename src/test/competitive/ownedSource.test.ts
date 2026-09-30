import {describe,it,expect} from 'vitest';
import {normalizeOwnedCompetitive} from '../../../supabase/functions/_shared/competitive/ownedSource';
import {mergeOwnedCompetitivePosts} from '../../../supabase/functions/_shared/competitive/ownedMerge';
import {competitiveCompanyMetrics} from '../../../supabase/functions/_shared/competitive/reportMetrics';
import {competitiveReportQuality} from '../../../supabase/functions/_shared/competitive/reportEvidence';

const period={start:'2026-08-01',end:'2026-08-31'};
const profiles=[{sprout_profile_id:1,network_type:'instagram',profile_name:'Brand'},{sprout_profile_id:2,network_type:'instagram',profile_name:'Brand Nation'},{sprout_profile_id:3,network_type:'linkedin',profile_name:'Brand LinkedIn'}];
const audience=profiles.flatMap(p=>['2026-07-01','2026-07-31','2026-08-01','2026-08-31','2026-09-29'].map(date=>({dimensions:{customer_profile_id:p.sprout_profile_id,'reporting_period.by(day)':date},metrics:{'lifetime_snapshot.followers_count':p.sprout_profile_id*1000}})));
const post=(id:number,date:string,guid=String(id))=>({customer_profile_id:id,network:id===3?'LINKEDIN':'INSTAGRAM',guid,created_time:date+'T12:00:00Z',post_type:id===3?'LINKEDIN_COMPANY_UPDATE':'INSTAGRAM_MEDIA',content_category:'PHOTO',perma_link:'https://example.com/post/'+guid,metrics:{'lifetime.likes':10,'lifetime.reactions':10,'lifetime.comments_count':2,'lifetime.shares_count':5,'lifetime.impressions':100,'lifetime.post_content_clicks':90,'lifetime.saves':20}});
const normalize=(rows:any[],observations=audience)=>normalizeOwnedCompetitive(profiles,period,rows,observations,'2026-09-30T07:00:00Z');

describe('owned competitive sources',()=>{
 it('collects multiple assigned profiles per network, separates periods, and excludes private actions',()=>{
  const result=normalize([post(1,'2026-08-02'),post(2,'2026-08-03'),post(3,'2026-08-04'),post(2,'2026-07-02','previous')]);
  expect(result.posts).toHaveLength(3);
  expect(result.posts.map(p=>p.engagementTotal)).toEqual([12,12,17]);
  expect(result.metrics.by_network.instagram.posts).toEqual({current:2,previous:1});
  expect(result.metrics.by_network.instagram.engagement).toEqual({current:24,previous:12});
  expect(result.metrics.by_network.instagram.followers).toEqual({current:3000,previous:3000});
  expect(result.metrics.by_network.instagram.rate.current).toBeCloseTo(.009,10);
  expect(result.metrics.audience_snapshot.by_network.instagram).toEqual({followers:3000,as_of:'2026-09-29'});
 });
 it('deduplicates exact identities and excludes stories and unsent posts',()=>{
  const row=post(1,'2026-08-02');
  expect(normalize([row,row,{...post(2,'2026-08-02'),post_type:'INSTAGRAM_STORY'},{...post(3,'2026-08-02'),sent:false}]).posts).toHaveLength(1);
 });
 it('rejects another client, wrong network, wrong dates, and unknown engagement instead of reporting zeros',()=>{
  expect(()=>normalize([post(999,'2026-08-02')])).toThrow('unassigned');
  expect(()=>normalize([{...post(1,'2026-08-02'),network:'FACEBOOK'}])).toThrow('network');
  expect(()=>normalize([post(1,'2026-09-01')])).toThrow('outside');
  const partial=normalize([{...post(1,'2026-08-02'),metrics:{'lifetime.likes':10}}]);
  expect(partial.posts[0].engagementTotal).toBe(10);expect(partial.posts[0].conversation).toBe(0);
 });
 it('replaces own public copies only for collected networks, preserves rivals and uncovered networks',()=>{
  const result=normalize([post(1,'2026-08-02'),post(2,'2026-08-03')]);
  const existing=[{companyId:'client',channel:'instagram',postLink:'https://example.com/post/1',image:'original-image'},{companyId:'client',channel:'twitter'},{companyId:'rival',channel:'instagram'}];
  const merged=mergeOwnedCompetitivePosts(existing,result,{id:'client',name:'Brand'});
  expect(merged).toHaveLength(4);expect(merged[0]).toEqual(existing[1]);expect(merged[1]).toEqual(existing[2]);
  expect(merged[2].image).toBe('original-image');expect(merged[3].source_profile_name).toBe('Brand Nation');
  expect(mergeOwnedCompetitivePosts(existing,{coverage:'not_connected'},{id:'client',name:'Brand'})).toBe(existing);
 });
 it('reconciles metrics without double-counting RivalIQ or LinkedIn copies',()=>{
  const owned=normalize([post(1,'2026-08-02'),post(2,'2026-08-03'),post(3,'2026-08-04')]);
  const r={period,posts:{current:1,previous:0},engagement:{current:12,previous:0},audience:{current:1000,previous:1000},by_network:{instagram:{posts:{current:1,previous:0},engagement:{current:12,previous:0},followers:{current:1000,previous:1000}}}};
  const result=competitiveCompanyMetrics({rivaliq_metrics:r,owned_metrics:owned.metrics,linkedin_metrics:{coverage:'complete',posts:1,engagement:17}});
  expect(result.posts.current).toBe(3);expect(result.engagement.current).toBe(41);expect(result.audience.current).toBe(3000);
  expect(result.actual_impressions.current).toBe(300);expect(result.owned_profile_scope).toHaveLength(3);
  expect(()=>competitiveCompanyMetrics({rivaliq_metrics:r,owned_metrics:{...owned.metrics,period:{...period,start:'2026-08-02'}}})).toThrow('period');
 });
 it('blocks delivery when observed posts do not reconcile with owned totals',()=>{
  const owned=normalize([post(1,'2026-08-02'),post(2,'2026-08-03')]);
  const quality=competitiveReportQuality({period,aggregates:{metric_semantics_version:4,companies:[{name:'Brand',owned_metrics:owned.metrics,by_channel:{instagram:{observed_post_count:1}},rivaliq_metrics:{period,posts:{current:1}}}]}});
  expect(quality.ready).toBe(false);expect(quality.reasons.join(' ')).toContain('did not reconcile');
 });
});
