import { expect, it } from 'vitest';
import { competitiveReportQuality, withCompetitiveEvidenceLimits } from '../../../supabase/functions/_shared/competitive/reportEvidence';

const fixture = () => ({schema_note:'Existing coverage note.', aggregates:{companies:[
  {name:'Client',is_client:true,post_count:0,rivaliq_metrics:{posts:{current:0},audience:{current:9332}}},
  {name:'Rival',is_client:false,post_count:22},
]},ai_analysis:{executive_summary:'Client has no strategy',gaps_for_client:[{gap:'No content'}],recommended_schedule:{Mon:3},posting_time_insights:{empty_airtime:'Post more'},benchmark_scorecard:{client_score:5},competitor_breakdowns:[{name:'CLIENT',is_client:true,copy_style:'Absent'},{name:'Rival',copy_style:'Observed style'}]}});

it('withholds unsupported client strategy claims while preserving provider zeros and competitor evidence',()=>{
  const original=fixture(),result=withCompetitiveEvidenceLimits(original);
  expect(result.aggregates).toEqual(original.aggregates);
  expect(result.ai_analysis.executive_summary).toContain('no client post sample');
  expect(result.ai_analysis.gaps_for_client).toEqual([]);
  expect(result.ai_analysis.recommended_schedule).toBeNull();
  expect(result.ai_analysis.posting_time_insights).toBeNull();
  expect(result.ai_analysis.benchmark_scorecard.client_score).toBeNull();
  expect(result.ai_analysis.competitor_breakdowns).toEqual([{name:'Rival',copy_style:'Observed style'}]);
  expect(result.schema_note).toContain('Existing coverage note.');
  expect(result.schema_note).not.toContain('does not establish');
  expect(original.ai_analysis.executive_summary).toBe('Client has no strategy');
  expect(withCompetitiveEvidenceLimits(result)).toEqual(result);
});
it('does not suppress supported client analysis when only a rival has no observations',()=>{
  const original=fixture();original.aggregates.companies[0].post_count=10;original.aggregates.companies[1].post_count=0;
  const result=withCompetitiveEvidenceLimits(original);
  expect(result.ai_analysis.executive_summary).toBe(original.ai_analysis.executive_summary);
  expect(result.ai_analysis.competitor_breakdowns).toEqual([original.ai_analysis.competitor_breakdowns[0]]);
});
it('leaves populated reports and unknown legacy post counts unchanged',()=>{
  for(const post_count of [10,undefined,null]) {
    const report={aggregates:{companies:[{name:'Client',is_client:true,post_count}]},ai_analysis:{executive_summary:'Original'}};
    expect(withCompetitiveEvidenceLimits(report)).toBe(report);
  }
  expect(withCompetitiveEvidenceLimits(null)).toBeNull();
});

it('distinguishes an incomplete post sample from provider period totals without changing either',()=>{
 const report={aggregates:{companies:[{name:'Navy Federal',post_count:61,rivaliq_metrics:{posts:{current:73}}}]}};
 const result:any=withCompetitiveEvidenceLimits(report);expect(competitiveReportQuality(result)).toEqual({ready:false,reasons:['Navy Federal: 61 dated posts; 73 provider period total.']});expect(result.aggregates).toEqual(report.aggregates);
});

it('holds partial windows and preserves internal review holds',()=>{
 expect(competitiveReportQuality({totals:{windows_failed:1}}).ready).toBe(false);
 expect(competitiveReportQuality({quality_check:{state:'needs_review',reasons:['Verify period']}}).ready).toBe(false);
});
it('allows matching measured zeros without claiming missing publishing activity',()=>{
 expect(competitiveReportQuality(fixture()).ready).toBe(true);
});
it('removes the old diagnostic paragraph from derived report narrative',()=>{
 const input={...fixture(),schema_note:"RivalIQ returned no in-period posts for Client. This does not establish ..."};
 expect(withCompetitiveEvidenceLimits(input).schema_note).toBe('');
});

it('holds legacy narratives with incorrect rate weighting or follower-as-reach claims',()=>{
 const report={aggregates:{companies:[{name:'Client',reach_total:2000,engagement_rate_avg:0.0136,rivaliq_metrics:{engagement_rate_per_post:{current:0.0015488}}}]},ai_analysis:{executive_summary:'2K reach'}};
 expect(competitiveReportQuality(report).reasons).toHaveLength(2);
 expect(competitiveReportQuality({...report,ai_analysis:undefined}).ready).toBe(true);
 expect(competitiveReportQuality({...report,aggregates:{...report.aggregates,metric_semantics_version:2}}).ready).toBe(true);
});

it('holds a network mismatch even when cross-network counts cancel out, and missing company metrics',()=>{
 expect(competitiveReportQuality({aggregates:{companies:[{name:'A',post_count:2,by_channel:{instagram:{post_count:2}},rivaliq_metrics:{posts:{current:2},by_network:{instagram:{posts:{current:1}},facebook:{posts:{current:1}}}}}]}}).reasons).toHaveLength(2);
 expect(competitiveReportQuality({aggregates:{metrics_available:true,companies:[{name:'A'}]}}).ready).toBe(false);
});

it('calculates the summary from provider metrics instead of preserving unsupported AI headline claims',()=>{
 const input={aggregates:{metric_semantics_version:2,companies:[{name:'Client',is_client:true,post_count:2,rivaliq_metrics:{posts:{current:2,previous:4},engagement_rate_per_post:{current:0.0015,previous:0.002},audience:{current:1000,previous:990}}},{name:'Rival',post_count:3,rivaliq_metrics:{posts:{current:3}}}]},ai_analysis:{executive_summary:'Guaranteed reach lift of 25%'}};
 const out=withCompetitiveEvidenceLimits(input);
 expect(out.ai_analysis.executive_summary).toContain('0.15%');expect(out.ai_analysis.executive_summary).toContain('up 10');expect(out.ai_analysis.executive_summary).not.toContain('Guaranteed');expect(input.ai_analysis.executive_summary).toContain('Guaranteed');
});

it('does not recommend copying a competitor with no observed posts', () => {
 const report={aggregates:{companies:[{name:'Kiron Interactive',post_count:0},{name:'GoldenRace',post_count:11}]},ai_analysis:{winner_teardown:[{competitor:'Kiron Interactive',pattern:'No observed content'},{competitor:'GoldenRace',pattern:'Product demonstrations'}]}};
 const result=withCompetitiveEvidenceLimits(report);
 expect(result.ai_analysis.winner_teardown).toEqual([{competitor:'GoldenRace',pattern:'Product demonstrations'}]);
 expect(report.ai_analysis.winner_teardown).toHaveLength(2);
});

it('accepts provider totals independently of sample size only under the new period-validated policy', () => {
 const report={aggregates:{metric_semantics_version:3,metrics_available:true,period:{start:'2026-08-25',end:'2026-09-23'},companies:[{name:'LegaBot',post_count:52,observed_post_count:54,rivaliq_metrics:{period:{start:'2026-08-25',end:'2026-09-23'},posts:{current:52},by_network:{instagram:{posts:{current:47}}}},by_channel:{instagram:{post_count:47,observed_post_count:49}}}]}};
 expect(competitiveReportQuality(report).ready).toBe(true);
 const wrong=structuredClone(report);wrong.aggregates.companies[0].rivaliq_metrics.period.start='2026-08-24';
 expect(competitiveReportQuality(wrong).ready).toBe(false);
 expect(competitiveReportQuality({...report,totals:{windows_failed:1}}).ready).toBe(false);
 expect(competitiveReportQuality({...report,quality_check:{state:'needs_review',reasons:['Previously held; needs regeneration']}}).ready).toBe(false);
});
it('does not infer content strategy from provider counts without sampled posts', () => {
 const report={aggregates:{companies:[{name:'Kiron',post_count:10,observed_post_count:0}]},ai_analysis:{winner_teardown:[{competitor:'Kiron',pattern:'Invented'}]}};
 expect(withCompetitiveEvidenceLimits(report).ai_analysis.winner_teardown).toEqual([]);
});
