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
function merge(rows = fixture) {
  const nodes: any = {'Run Config':{range_start:period.start,range_end:period.end},'Prepare LinkedIn Sources':{has_sources:true,sources:[{company_id:'42',name:'Medisafe',profile_url:profile}]},'Merge Post Pages':{socialPosts:[],expected_windows:5}};
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
  expect(c.post_count).toBe(5);expect(c.comparison_metrics.engagement.current).toBe(16);expect(c.comparison_metrics.audience.current).toBeNull();expect(c.comparison_metrics.engagement_rate_per_post.current).toBeNull();expect(c.rivaliq_metrics).toEqual(raw);expect(c.rivaliq_metrics.posts.current).toBe(0);
  expect(normalizedCompetitiveMetrics(result)).toEqual(result);expect(competitiveReportQuality(result).ready).toBe(true);
  const stale=structuredClone(result);stale.aggregates.companies[0].linkedin_metrics.period.start='2026-07-01';expect(competitiveReportQuality(stale).ready).toBe(false);
});
it('saves source evidence before analysis and handles snapshot failures', () => {
  const graph=JSON.parse(readFileSync('n8n/fixtures/competitive-source-graph.json','utf8'));
  const targets=(name:string, branch=0)=>graph.connections[name].main[branch].map((x:any)=>x.node);
  expect(targets('Merge LinkedIn Posts')).toEqual(['Cache Posts Snapshot']);
  expect(targets('Cache Posts Snapshot')).toEqual(['Aggregate Competitive Data']);
  expect(targets('Cache Posts Snapshot',1)).toEqual(['Mark Report Failed']);
  expect(graph.nodes.find((n:any)=>n.name==='Cache Posts Snapshot').onError).toBe('continueErrorOutput');
});
