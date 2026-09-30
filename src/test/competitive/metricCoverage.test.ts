import {expect,it} from 'vitest';
import {competitiveCompanyMetrics,normalizedCompetitiveMetrics} from '../../../supabase/functions/_shared/competitive/reportMetrics';

const period={start:'2026-08-01',end:'2026-08-31'};
const previous_period={start:'2026-07-01',end:'2026-07-31'};
const raw={period,previous_period,posts:{current:4,previous:9},engagement:{current:7,previous:26},audience:{current:9325,previous:9331},estimated_impressions:{current:684,previous:944},engagement_rate_per_post:{current:.0003781331,previous:.0008746},by_network:{facebook:{followers:{current:5595,previous:5594}}}};
const li={provider:'apify/harvestapi',coverage:'complete',period,posts:14,engagement:92};
it('preserves measured audience, impressions and rates when LinkedIn adds activity',()=>{
 const input={period,aggregates:{metric_semantics_version:4,companies:[{is_client:true,post_count:18,observed_post_count:18,rivaliq_metrics:raw,linkedin_metrics:li}]}};
 const report=normalizedCompetitiveMetrics(input),company=report.aggregates.companies[0] as any;
 expect(company.comparison_metrics.audience).toEqual(raw.audience);
 expect(company.comparison_metrics.estimated_impressions).toEqual(raw.estimated_impressions);
 expect(company.comparison_metrics.engagement_rate_per_post).toEqual(raw.engagement_rate_per_post);
 expect(company.post_count).toBe(18);expect(company.engagement_avg).toBe(99/18);
 expect(company.impressions_avg).toBe(684/4);expect(company.comparison_metrics.posts.previous).toBeNull();
 expect(company.rivaliq_metrics).toEqual(raw);expect(normalizedCompetitiveMetrics(report)).toEqual(report);
});
it('restores historical comparisons only with verified matching LinkedIn periods',()=>{
 const linked={...li,previous:{coverage:'complete',period:previous_period,posts:15,engagement:120}};
 const result=competitiveCompanyMetrics({rivaliq_metrics:raw,linkedin_metrics:linked});
 expect(result.posts).toEqual({current:18,previous:24});expect(result.engagement.previous).toBe(146);
 expect(competitiveCompanyMetrics({rivaliq_metrics:raw,linkedin_metrics:{...linked,previous:{...linked.previous,period:{start:'2026-06-01',end:'2026-06-30'}}}}).posts.previous).toBeNull();
});
it('fills missing audience from a dated real snapshot without fabricating historical growth',()=>{
 const historical={...raw,audience:{current:null,previous:null},by_network:{facebook:{followers:{current:null,previous:null}}}};
 const result=competitiveCompanyMetrics({rivaliq_metrics:historical,rivaliq_audience_snapshot:{as_of:'2026-09-29',audience:27700,by_network:{facebook:1080}}});
 expect(result.audience).toEqual({current:27700,previous:null});expect(result.audience_as_of).toBe('2026-09-29');
 expect(result.by_network.facebook.followers.current).toBe(1080);expect(historical.audience.current).toBeNull();
 const known=competitiveCompanyMetrics({rivaliq_metrics:raw,rivaliq_audience_snapshot:{as_of:'2026-09-29',audience:9999}});
 expect(known.audience.current).toBe(9325);expect(known.audience_as_of).toBeUndefined();
});
