import {describe,it,expect} from 'vitest';
import {isPublishedPost,normalizeOwnedCompetitive} from '../../../supabase/functions/_shared/competitive/ownedSource';
import {mergeOwnedCompetitivePosts} from '../../../supabase/functions/_shared/competitive/ownedMerge';
import {competitiveCompanyMetrics,normalizedCompetitiveMetrics} from '../../../supabase/functions/_shared/competitive/reportMetrics';
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
  // Per-follower rates left the product: the owned source carries totals only.
  expect(result.metrics.by_network.instagram.rate).toBeUndefined();
  expect(result.metrics.by_network.instagram.impressions).toEqual({current:200,previous:100});
  expect(result.posts[0].engagementRate).toBeUndefined();
  expect(result.metrics.audience_snapshot.by_network.instagram).toEqual({followers:3000,as_of:'2026-09-29'});
 });
 it('deduplicates exact identities and excludes stories and unsent posts',()=>{
  const row=post(1,'2026-08-02');
  expect(normalize([row,row,{...post(2,'2026-08-02'),post_type:'INSTAGRAM_STORY'},{...post(3,'2026-08-02'),sent:false}]).posts).toHaveLength(1);
 });
 it('counts no ads as posts: every Sprout ad post type, and every "fa:" ad guid',()=>{
  const ads=['FACEBOOK_AD','TIKTOK_AD','FB_INSTAGRAM_AD_POST','FACEBOOK_AD_COMMENT','AD_POST'].map((post_type,i)=>({...post(1,'2026-08-02','ad'+i),post_type}));
  // Bader Law, Sept 2026: 29 zero-impression copies of one caption, stored with "fa:" guids under an ordinary type.
  const faGuid={...post(2,'2026-08-03','fa:62392002280_1683812133750940'),post_type:'INSTAGRAM_MEDIA'};
  const result=normalize([...ads,faGuid,post(1,'2026-08-04','p:real')]);
  expect(result.posts.map((p:any)=>p.postId)).toEqual(['sprout:p:real']);
  expect(result.metrics.by_network.instagram.posts.current).toBe(1);
  expect(isPublishedPost({post_type:'FACEBOOK_POST',guid:'p:1'})).toBe(true);
  expect(isPublishedPost({post_type:'FACEBOOK_REEL',guid:'p:2'})).toBe(true);
  expect(isPublishedPost({post_type:'LINKEDIN_COMPANY_UPDATE',guid:'li:1'})).toBe(true);
  expect(isPublishedPost({post_type:'YOUTUBE_VIDEO',guid:'yt:1'})).toBe(true);
  for (const post_type of ['FACEBOOK_AD','TIKTOK_AD','FB_INSTAGRAM_AD_POST','INSTAGRAM_STORY','TWITTER_DIRECT_MESSAGE','YOUTUBE_COMMENT','THREADS_REPLY','FACEBOOK_RATING','INSTAGRAM_PHOTO_TAG']) expect(isPublishedPost({post_type}),post_type).toBe(false);
  expect(isPublishedPost({post_type:'FACEBOOK_POST',guid:'fa:1_2'})).toBe(false);
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
 // The client's own figures come from Sprout on every platform it covers
 // (Lital, 20 Oct 2026); a platform Sprout does not cover keeps RivalIQ's.
 it('uses the client\'s Sprout figures platform by platform, and RivalIQ where Sprout has none',()=>{
  const owned=normalize([post(1,'2026-08-02'),post(2,'2026-08-03'),post(3,'2026-08-04')]);
  const r={period,posts:{current:4,previous:0},engagement:{current:30,previous:0},audience:{current:1500,previous:1500},estimated_impressions:{current:900,previous:0},by_network:{
   instagram:{posts:{current:1,previous:0},engagement:{current:12,previous:0},followers:{current:1000,previous:1000},impressions:{current:400,previous:0}},
   twitter:{posts:{current:3,previous:0},engagement:{current:18,previous:0},followers:{current:500,previous:500},impressions:{current:500,previous:0}}}};
  const result=competitiveCompanyMetrics({rivaliq_metrics:r,owned_metrics:owned.metrics,linkedin_metrics:{coverage:'complete',posts:1,engagement:17}} as any);
  // Sprout: two Instagram posts and one LinkedIn post (Sprout's LinkedIn replaces the public copy); RivalIQ: three on X.
  expect(result.posts.current).toBe(6);expect(result.engagement.current).toBe(12+12+17+18);
  expect(result.by_network.instagram).toMatchObject({posts:{current:2,previous:0},source:'sprout'});
  expect(result.by_network.twitter.posts.current).toBe(3);expect(result.by_network.twitter.source).toBeUndefined();
  // Followers across platforms leave LinkedIn out, as for every company: Sprout's Instagram 3,000 and RivalIQ's X 500.
  expect(result.audience.current).toBe(3500);
  // The rate: Sprout's Instagram (24 over 200) with RivalIQ's X (18 over 500), LinkedIn left out.
  expect(result.engagement_rate.current).toBe((24+18)/(200+500));
  expect(result.by_network.linkedin.engagement_rate.current).toBe(17/100);
  expect(result.owned_profile_scope.map((p:any)=>p.network)).toEqual(['instagram','instagram','linkedin']);
  expect(()=>competitiveCompanyMetrics({rivaliq_metrics:r,owned_metrics:{...owned.metrics,period:{...period,start:'2026-08-02'}}})).toThrow('period');
 });
 it('shows the client\'s platforms that only Sprout covers, from Sprout',()=>{
  const owned=normalize([post(1,'2026-08-02'),post(3,'2026-08-04')]);
  const r={period,posts:{current:2,previous:0},engagement:{current:9,previous:0},audience:{current:1000,previous:1000},estimated_impressions:{current:300,previous:0},by_network:{instagram:{posts:{current:2,previous:0},engagement:{current:9,previous:0},impressions:{current:300,previous:0}}}};
  const out:any=normalizedCompetitiveMetrics({period,aggregates:{metric_semantics_version:4,period,companies:[{name:'Brand',is_client:true,post_count:4,rivaliq_metrics:r,owned_metrics:owned.metrics,by_channel:{instagram:{post_count:1},linkedin:{post_count:1}}}]}});
  const c=out.aggregates.companies[0];
  expect(c.post_count).toBe(2);expect(Object.keys(c.by_channel).sort()).toEqual(['instagram','linkedin']);
  expect(c.by_channel.instagram.post_count).toBe(1);expect(c.by_channel.linkedin.post_count).toBe(1);
  expect(c.by_channel.linkedin.engagement_rate_avg).toBe(17/100);
 });
 it('blocks delivery when observed posts do not reconcile with owned totals',()=>{
  const owned=normalize([post(1,'2026-08-02'),post(2,'2026-08-03')]);
  const quality=competitiveReportQuality({period,aggregates:{metric_semantics_version:4,companies:[{name:'Brand',owned_metrics:owned.metrics,by_channel:{instagram:{observed_post_count:1}},rivaliq_metrics:{period,posts:{current:1}}}]}});
  expect(quality.ready).toBe(false);expect(quality.reasons.join(' ')).toContain('did not reconcile');
 });
});
