// @vitest-environment node
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizedCompetitiveMetrics } from '../../../supabase/functions/_shared/competitive/reportMetrics';
import { competitiveReportQuality } from '../../../supabase/functions/_shared/competitive/reportEvidence';
const fixture = JSON.parse(readFileSync('scripts/fixtures/linkedin-source-posts.json','utf8'));
const source = readFileSync('n8n/code/merge-linkedin-posts.js','utf8');
const profile = 'https://www.linkedin.com/company/medisafe-project';
const period = {start:'2026-08-30',end:'2026-09-28'};
function merge(rows = fixture, reviewedProfile = profile, previous_period?: {start:string;end:string}) {
  const nodes: any = {'Run Config':{range_start:period.start,range_end:period.end},'Prepare LinkedIn Sources':{previous_period,has_sources:true,sources:[{company_id:'42',name:'Medisafe',profile_url:reviewedProfile}]},'Merge Post Pages':{socialPosts:[],expected_windows:5}};
  return runInNewContext('(function(){'+source+'})()', {$: (n:string)=>({first:()=>({json:nodes[n]})}),$input:{all:()=>rows.map((json:any)=>({json}))}})[0].json;
}
it('imports verified real posts with source identity, publication dates and engagement', () => {
  const result=merge(); expect(result.linkedin_posts).toBe(5); expect(result.additional_metrics['42'].engagement).toBe(16);
  expect(result.socialPosts.every((p:any)=>p.channel==='linkedin' && p.companyId==='42' && p.postLink.startsWith('https://www.linkedin.com/'))).toBe(true);
});
it('does not attribute a different company author to the requested competitor', () => {
  const rows=structuredClone(fixture);rows[0].author.linkedinUrl='https://www.linkedin.com/company/unrelated';
  expect(()=>merge(rows)).toThrow('author does not match');
});
it('accepts numeric LinkedIn URLs only when the author has the identical company ID', () => {
  const numeric = 'https://www.linkedin.com/company/1761291';
  const row = structuredClone(fixture[0]);
  row.query.targetUrl = numeric;
  row.author = {type:'company',companyId:'1761291',linkedinUrl:'https://www.linkedin.com/company/kiron-interactive/posts'};
  expect(merge([row], numeric).linkedin_posts).toBe(1);
  row.author.companyId = '17612910';
  expect(()=>merge([row], numeric)).toThrow('author does not match');
  row.author.companyId = '1761291'; row.author.type = 'person';
  expect(()=>merge([row], numeric)).toThrow('author does not match');
  row.author.type = 'company'; row.author.linkedinUrl = 'https://www.linkedin.com/in/person';
  expect(()=>merge([row], numeric)).toThrow('author does not match');
});
it('filters by the requested date range and deduplicates posts', () => {
  const old=structuredClone(fixture[0]);old.id='older';old.postedAt.date='2026-07-01T00:00:00Z';
  expect(merge([...fixture,...fixture,old]).linkedin_posts).toBe(5);
});
it('never converts source errors, missing dates, missing engagement or truncation into zero activity', () => {
  expect(()=>merge([{error:'unavailable'}])).toThrow('collection returned an error');
  const missing=structuredClone(fixture);missing[0].postedAt.date='';expect(()=>merge(missing)).toThrow('publication date');
  const noMetric=structuredClone(fixture);delete noMetric[0].engagement.likes;expect(()=>merge(noMetric)).toThrow('engagement counts');
  expect(()=>merge(Array.from({length:150},()=>fixture[0]))).toThrow('per-company limit');
});
it('combines period totals without relabeling or changing RivalIQ evidence', () => {
  const linkedin=merge().additional_metrics['42'];
  const raw={period,posts:{current:0,previous:2},engagement:{current:0,previous:10},audience:{current:9000},engagement_rate_per_post:{current:.2},by_network:{facebook:{posts:{current:0}}}};
  const input={period,aggregates:{metric_semantics_version:4,metrics_available:true,companies:[{name:'Medisafe',company_id:'42',post_count:0,observed_post_count:5,linkedin_metrics:linkedin,rivaliq_metrics:raw,by_channel:{linkedin:{post_count:5}}}]}};
  const result=normalizedCompetitiveMetrics(input),c=result.aggregates.companies[0];
  expect(c.post_count).toBe(5);expect(c.comparison_metrics.engagement.current).toBe(16);expect(c.comparison_metrics.audience.current).toBe(9000);expect(c.comparison_metrics.engagement_rate_per_post.current).toBeNull();expect(c.rivaliq_metrics).toEqual(raw);expect(c.rivaliq_metrics.posts.current).toBe(0);
  expect(normalizedCompetitiveMetrics(result)).toEqual(result);expect(competitiveReportQuality(result).ready).toBe(true);
  const stale=structuredClone(result);stale.aggregates.companies[0].linkedin_metrics.period.start='2026-07-01';expect(competitiveReportQuality(stale).ready).toBe(false);
});

it('collects a separate previous period and a dated current follower observation', () => {
 const previous={start:'2026-07-31',end:'2026-08-29'};
 const row=structuredClone(fixture[0]);row.id='previous';row.postedAt.date='2026-08-10T12:00:00Z';
 row.author.type='company';row.author.info='12,345 followers';
 const result=merge([...fixture,row],profile,previous), metrics=result.additional_metrics['42'];
 expect(metrics.posts).toBe(5);expect(metrics.previous.posts).toBe(1);
 expect(metrics.previous.engagement).toBe(row.engagement.likes+row.engagement.comments+row.engagement.shares);
 expect(metrics.audience_snapshot.followers).toBe(12345);expect(metrics.audience_snapshot.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
 expect(result.socialPosts).toHaveLength(5);
 row.author.info='12.3K followers';expect(merge([row],profile,previous).additional_metrics['42'].audience_snapshot).toBeUndefined();
});
it('saves source evidence before analysis and handles snapshot failures', () => {
  const graph=JSON.parse(readFileSync('n8n/fixtures/competitive-source-graph.json','utf8'));
  const targets=(name:string, branch=0)=>graph.connections[name].main[branch].map((x:any)=>x.node);
  expect(targets('Merge LinkedIn Posts')).toEqual(['Collect Owned Client Data']);
  expect(targets('Collect Owned Client Data')).toEqual(['Merge Owned Posts']);
  expect(targets('Merge Owned Posts')).toEqual(['Cache Posts Snapshot']);
  expect(targets('Cache Posts Snapshot')).toEqual(['Aggregate Competitive Data']);
  expect(targets('Cache Posts Snapshot',1)).toEqual(['Mark Report Failed']);
  expect(graph.nodes.find((n:any)=>n.name==='Cache Posts Snapshot').onError).toBe('continueErrorOutput');
});

it('uses connected LinkedIn company handles when Sprout provides no native URL', () => {
 const prepare=readFileSync('n8n/code/prepare-linkedin-sources.js','utf8');
 const nodes:any={'Run Config':{range_start:period.start},'Competitive Webhook':{body:{client_profiles:[{platform:'linkedin',url:'',handle:'moburst'}],competitors:[]}},'Resolve Landscape':{client_company_id:1,companies:[{id:1,name:'Moburst'}]}};
 const result=runInNewContext('(function(){'+prepare+'})()',{$:(n:string)=>({first:()=>({json:nodes[n]})})})[0].json;
 expect(result.sources[0].profile_url).toBe('https://www.linkedin.com/company/moburst');
 expect(result.input.targetUrls).toEqual(['https://www.linkedin.com/company/moburst']);
});

it('accepts verified company collaborations and excludes plain reposts without claiming authorship', () => {
 const row=structuredClone(fixture[0]);row.author.linkedinUrl='https://www.linkedin.com/in/author';
 row.header={imageLink:profile+'/?miniCompanyUrn=verified',text:'Medisafe collaborated on this'};
 expect(merge([row]).socialPosts[0].authorship).toBe('collaboration');
 row.header.text='Medisafe reposted this';expect(merge([row]).linkedin_posts).toBe(0);
 row.header.imageLink='https://www.linkedin.com/company/unrelated';expect(()=>merge([row])).toThrow('author does not match');
});

it('recognizes native LinkedIn videos and shared articles instead of reporting them as text posts', () => {
 const video=structuredClone(fixture[0]);video.postImages=[];video.postVideo={thumbnailUrl:'https://media.licdn.com/video.jpg',videoUrl:'https://dms.licdn.com/video.mp4'};
 const result=merge([video]).socialPosts[0];expect(result.type).toBe('video');expect(result.image).toBe(video.postVideo.thumbnailUrl);
 delete video.postVideo;video.article={image:{url:'https://media.licdn.com/article.jpg'},link:'https://example.com/article'};
 expect(merge([video]).socialPosts[0].type).toBe('link');
});
