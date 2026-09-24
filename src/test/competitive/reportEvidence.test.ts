import { expect, it } from 'vitest';
import { withCompetitiveEvidenceLimits } from '../../../supabase/functions/_shared/competitive/reportEvidence';

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
  expect(result.schema_note).toContain('does not establish');
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
 const result:any=withCompetitiveEvidenceLimits(report);expect(result.schema_note).toContain('61 posts returned, 73 in period metrics');expect(result.aggregates).toEqual(report.aggregates);
});
