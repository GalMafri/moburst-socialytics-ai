import { expect, it } from 'vitest';
import { normalizedCompetitiveMetrics } from '../../../supabase/functions/_shared/competitive/reportMetrics';
it('uses RivalIQ totals and denominators while retaining independent sample counts', () => {
 const source={aggregates:{metric_semantics_version:3,period:{start:'2026-08-25',end:'2026-09-23'},companies:[{is_client:true,post_count:54,by_channel:{instagram:{post_count:49}},rivaliq_metrics:{posts:{current:52},engagement:{current:6950},by_network:{instagram:{posts:{current:47},engagement:{current:6610}},tiktok:{posts:{current:5},engagement:{current:340}}}}}]}};
 const result=normalizedCompetitiveMetrics(source),c=result.aggregates!.companies![0] as any;
 expect(c.post_count).toBe(52);expect(c.observed_post_count).toBe(54);
 expect(c.engagement_avg).toBe(6950/52);expect(c.cadence_per_week).toBe(12.1);
 expect(c.by_channel.instagram.post_count).toBe(47);expect(c.by_channel.instagram.observed_post_count).toBe(49);expect(c.by_channel.instagram.engagement_avg).toBe(6610/47);
 expect(c.by_channel.tiktok.post_count).toBe(5);expect(c.by_channel.tiktok.observed_post_count).toBe(0);
 expect(normalizedCompetitiveMetrics(result)).toEqual(result);expect(source.aggregates.companies[0].post_count).toBe(54);
});
