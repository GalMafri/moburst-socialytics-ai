const cfg=$('Run Config').first().json;
const landscape=$('Resolve Landscape').first().json;
const collected=$('Collect Owned Client Data').first().json;
const input=$('Merge LinkedIn Posts').first().json;
if(collected.client_id!==cfg.client_id || collected.period?.start!==cfg.range_start || collected.period?.end!==cfg.range_end) throw new Error('Owned social source identity or period does not match this report');
if(!['complete','not_connected'].includes(collected.coverage)) throw new Error('Owned client source is incomplete');
const company={id:String(landscape.client_company_id),name:cfg.client_name};
return [{json:{...input,socialPosts:mergeOwnedCompetitivePosts(input.socialPosts||[],collected,company),
  owned_profiles:collected.profiles,owned_metrics:collected.metrics?{[company.id]:collected.metrics}:{},
  owned_source:{client_id:collected.client_id,coverage:collected.coverage,period:collected.period,collected_at:collected.collected_at,profiles:collected.profiles},
}}];
