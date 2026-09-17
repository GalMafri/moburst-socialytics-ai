const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const source = fs.readFileSync('supabase/functions/sprout-analytics/index.ts', 'utf8').split('Deno.serve(')[0].replace(/^import .*;\n/gm, '') + '\nexports.profileAnalytics = profileAnalytics;';
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const row = (profile, date, impressions) => ({dimensions:{customer_profile_id:profile,'reporting_period.by(day)':date},metrics:{impressions,comments_count:2,shares_count:1}});
async function run(responses) {
  const exports={}, requests=[];
  vm.runInNewContext(compiled, {exports, console, Date, Map, Set, Number, JSON, Error, URLSearchParams, defaultSproutCustomerId:()=> 'fixture', fetch:async (_url, options)=>{
    const body=JSON.parse(options.body); requests.push(body);
    return {ok:true,json:async()=>responses[Math.min(body.page-1,responses.length-1)]};
  }});
  const result=await exports.profileAnalytics('fixture','fixture',[1],'2026-08-01','2026-08-31');
  return {result,requests};
}
(async()=>{
  const first=row(1,'2026-08-01',10), second=row(1,'2026-08-02',20);
  const {result,requests}=await run([{data:[first],paging:{total_pages:2}},{data:[first,second],paging:{total_pages:2}}]);
  assert.equal(result.totals.impressions,30);assert.equal(result.totals.comments,4);assert.equal(result.totals.shares,2);
  assert.deepEqual(requests.map(r=>r.page),[1,2]);assert(requests[0].metrics.includes('comments_count'));assert(!requests[0].metrics.includes('comments'));
  await assert.rejects(()=>run([{data:[row(1,'2026-07-31',10)]}]),/outside/);
  await assert.rejects(()=>run([{data:[row(2,'2026-08-01',10)]}]),/unexpected profile/);
  await assert.rejects(()=>run([{error:'unavailable'}]),/no valid period data/);
  await assert.rejects(()=>run([{data:[],paging:{total_pages:101}}]),/incomplete/);
  console.log(JSON.stringify({passed:5,checks:['all pages, unique daily totals and correct provider metric names','out-of-range rejected','unexpected profile rejected','unavailable data rejected','page limit fails visibly']}));
})().catch(error=>{console.error(error);process.exitCode=1});
