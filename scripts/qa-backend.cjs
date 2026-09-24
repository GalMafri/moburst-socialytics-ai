const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const repo=path.resolve(process.env.QA_REPO || path.join(__dirname,'..'));
const ts=require(path.join(repo,'node_modules/typescript'));
const results=[];
const silent={log(){},error(){},warn(){}};
function moduleFrom(rel,deps={},globals={},transform=x=>x){
 const source=transform(fs.readFileSync(path.join(repo,rel),'utf8'));
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={}; const context={exports,module:{exports},console:silent,setTimeout,DOMException,Response,Request,Headers,URL,URLSearchParams,Date,Error,Number,JSON,Set,Map,fetch:()=>{throw Error('Outbound network forbidden')},...globals,require:name=>{if(name in deps)return deps[name];if(name.endsWith('/reports/competitiveRange.ts'))return moduleFrom('supabase/functions/_shared/reports/competitiveRange.ts',{},globals);if(name.endsWith('/competitive/reportEvidence.ts'))return moduleFrom('supabase/functions/_shared/competitive/reportEvidence.ts',{},globals);if(name==='../_shared/competitive/rivaliqFetch.ts')return moduleFrom('supabase/functions/_shared/competitive/rivaliqFetch.ts',{},globals);throw Error('Unmocked dependency: '+name)}};
 vm.runInNewContext(js,context,{filename:rel});return exports;
}
async function check(id,kind,name,fn){try{const evidence=await fn();results.push({id,kind,name,result:'pass',evidence});}catch(e){results.push({id,kind,name,result:'FAIL',error:String(e),stack:e.stack});}}

async function competitiveWritebackQa({authorized=true,op='report',failedWindows=0,periodTotal=0}={}){
 let handler;const state=database();state.tables.competitive_reports=[{id:'qa-report',status:'running',created_at:new Date().toISOString()}];
 state.tables.rivaliq_snapshots=[{report_id:'qa-report',endpoint:'socialposts',fetched_at:new Date().toISOString(),payload:{failed_windows:failedWindows,expected_windows:5}}];
 moduleFrom('supabase/functions/update-competitive-report/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>state.db},'../_shared/auth/secretEquals.ts':{secretEquals:async()=>authorized}},{Deno:{env:{get:()=> 'fixture'},serve:f=>handler=f}});
 const report_data={aggregates:{companies:[{name:'Fixture',is_client:true,post_count:0,rivaliq_metrics:{posts:{current:periodTotal}}}]},ai_analysis:{executive_summary:'Unsupported absence claim',gaps_for_client:[{gap:'Missing content'}]}};
 const response=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(op==='snapshot'?{op,landscape_id:'123',report_id:'qa-report',endpoint:'status',payload:{status:2}}:{op,report_id:'qa-report',status:'complete',report_data,duration_minutes:1})}));
 return{status:response.status,body:await response.json(),state};
}

async function scheduling({media=[],denied=false,missing=false,uploadFailure=false,partial=false,recordFailure=false,providerFailure=false,scopeControl=false}={}){
 let handler;const calls=[];let uploadIndex=0;
 const query={select(){return this},eq(){return this},async single(){return{data:{sprout_customer_id:'fixture'}}},async insert(){calls.push('record');return{error:recordFailure?{message:'fixture insert rejected'}:null}}};
 const deps={
  'https://deno.land/x/xhr@0.1.0/mod.ts':{},
  'https://deno.land/std@0.168.0/http/server.ts':{serve:f=>handler=f},
  'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>({from:()=>query})},
  '../_shared/sprout/customer.ts':{defaultSproutCustomerId:()=> 'fixture'},
  '../_shared/auth/requireStaff.ts':{staffGate:async()=>denied?new Response('{}',{status:401}):null},
 };
 moduleFrom('supabase/functions/schedule-sprout-post/index.ts',deps,{Deno:{env:{get:()=> 'fixture'}},fetch:async(url,opts)=>{
  const kind=url.includes('/publishing/posts')?'publish':url.includes('/media')?'media':'oauth';calls.push(kind);
  if(kind==='oauth')return new Response(JSON.stringify({access_token:'fixture'}));
  if(kind==='media'&&(uploadFailure||(partial&&uploadIndex++===0)))return new Response('{}',{status:422});
  if(kind==='publish'&&providerFailure)return new Response(JSON.stringify({error:'fixture rejected'}),{status:400});
  return new Response(JSON.stringify({id:'fixture'}));
 }},source=>scopeControl?source.replace('    if (allMediaUrls.length > 0) {\n      const uploadedMedia: { id: string }[] = [];','    const uploadedMedia: { id: string }[] = [];\n    if (allMediaUrls.length > 0) {'):source);
 const body=missing?{}:{client_id:'fixture-client',sprout_profile_id:1,post_content:'Fixture copy',scheduled_time:'2030-09-21T15:00:00Z',media_urls:media};
 const r=await handler(new Request('https://fixture.invalid/schedule',{method:'POST',body:JSON.stringify(body)}));
 return{status:r.status,body:await r.json(),calls};
}

function gamma(input,analysis={content_calendar:[{posts:[{copy:'Fixture'}]}]}){
 const source=fs.readFileSync(path.join(repo,'n8n/code/social-summary.js'),'utf8');
 return vm.runInNewContext('(function(){'+source+'})()',{
  $input:{first:()=>({json:input})},$:(name)=>({first:()=>({json:name==='AI Synthesis Agent'?{output:analysis}:name==='Workflow Configuration'?{current_month_start:'2026-09-01',current_month_end:'2026-09-17'}:{}})}),console:silent
 })[0].json;
}
function aggregate(start,end,count){
 const source=fs.readFileSync(path.join(repo,'n8n/code/competitive-aggregate.js'),'utf8');
 const nodes={'Run Config':{range_start:start,range_end:end,client_name:'Fixture'},'Resolve Landscape':{focus_company_id:1},'Landscape Companies':{companies:[{id:1,name:'Fixture'}]}};
 return vm.runInNewContext('(function(){'+source+'})()',{$:name=>({first:()=>({json:nodes[name]||{}})}),$input:{first:()=>({json:{socialPosts:Array.from({length:count},(_,i)=>({companyId:1,channel:'instagram',message:'Fixture '+i,publishedAt:start+'T12:00:00Z'}))}})},console:silent})[0].json;
}

function database({order=['competitive','social'],due=true,feedError=false}={}){
 const client={id:'fixture-client',name:'Fixture',primary_platforms:['instagram'],archived_at:null};
 const old={id:'old-complete',client_id:client.id,status:'complete',created_at:'2026-08-07T07:00:00Z',report_data:{ai_analysis:{executive_summary:'Prior cycle'},aggregates:{companies:[]}}};
 const competitors=[1,2,3].map(i=>({id:'fixture-competitor-'+i,set_id:'fixture-set',client_id:client.id,name:'Fixture competitor '+i,is_selected:true,selected_rank:i}));
 const competitor_handles=competitors.map((c,i)=>({id:'fixture-handle-'+i,competitor_id:c.id,client_id:client.id,platform:'instagram',handle:'fixture'+i,source:'auto',detection_confidence:.9,is_active:true}));
 const tables={reports:[],competitive_reports:[old],app_settings:[{key:'n8n_webhook_url',value:'https://fixture.invalid/social'},{key:'competitive_n8n_webhook_url',value:'https://fixture.invalid/competitive'}],report_schedules:due?order.map((kind,i)=>({id:'schedule-'+i,client_id:client.id,clients:client,report_kind:kind,is_active:true,next_run_at:'2020-01-01T00:00:00Z',frequency:'monthly',range_mode:'previous_month',run_day_of_month:7})):[],clients:[client],competitor_sets:[{id:'fixture-set',client_id:client.id,status:'confirmed',confirmed_at:'2026-01-01',clients:client}],rivaliq_snapshots:feedError?[]:[{client_id:client.id,endpoint:'feed',fetched_at:new Date().toISOString()}],sprout_profiles:[],competitive_insight_feedback:[],competitors,competitor_handles};
 const operations=[];
 const db={async rpc(name,args){if(name!=='claim_report_schedule')throw Error('Unmocked RPC');const row=tables.report_schedules.find(r=>r.id===args.schedule_id && r.next_run_at===args.expected_next_run_at && r.is_active && !r.dispatch_claimed_at);if(row)row.dispatch_claimed_at=new Date().toISOString();return{data:!!row,error:null}},from(table){const filters=[];let mode='select',payload,one=false,limit=Infinity,sort;const q={
  select(){return q},throwOnError(){return q},is(k,v){filters.push(r=>v===null?r[k]==null:r[k]===v);return q},eq(k,v){filters.push(r=>r[k]===v);return q},neq(k,v){filters.push(r=>r[k]!==v);return q},in(k,vs){filters.push(r=>vs.includes(r[k]));return q},lt(k,v){filters.push(r=>r[k]<v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},order(k,opt){sort={k,desc:opt?.ascending===false};return q},limit(v){limit=v;return q},insert(v){mode='insert';payload=v;return q},update(v){mode='update';payload=v;return q},single(){one=true;return q},maybeSingle(){one=true;return q},
  then(resolve,reject){try{
   const data=tables[table]||[];let rows=data.filter(r=>filters.every(fn=>fn(r)));
   if(mode==='insert'){const row={id:'new-'+table+'-'+data.length,created_at:new Date().toISOString(),...payload};data.push(row);rows=[row];operations.push({table,mode,id:row.id});}
   if(mode==='update'){rows.forEach(r=>Object.assign(r,payload));operations.push({table,mode,payload});}
   if(sort)rows.sort((a,b)=>(a[sort.k]<b[sort.k]?-1:a[sort.k]>b[sort.k]?1:0)*(sort.desc?-1:1));rows=rows.slice(0,limit);
   return Promise.resolve({data:one?(rows[0]||null):rows,error:null}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject)}}};return q}};
 return{db,tables,operations};
}
function payloadModule(){return moduleFrom('supabase/functions/_shared/reports/payloads.ts',{'../sprout/customer.ts':{defaultSproutCustomerId:()=> 'fixture'},'../competitive/reportMetrics.ts':moduleFrom('supabase/functions/_shared/competitive/reportMetrics.ts')});}
function actualStaffGuard({staff=true,valid=true,canWrite=true,roleError=false}={}){
 const authz=moduleFrom('supabase/functions/_shared/auth/authz.ts');
 const caller={auth:{getUser:async()=>({data:{user:valid?{id:'fixture-user'}:null},error:null})},rpc:async(name)=>({data:name==='is_moburst_staff'?staff:canWrite,error:roleError?{message:'Fixture role lookup failed'}:null})};
 return moduleFrom('supabase/functions/_shared/auth/requireStaff.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>caller},'./authz.ts':authz},{Deno:{env:{get:()=> 'fixture'}}});
}
async function runScheduler(options={}){
 const state=options.state || database(options);let handler;const requests=[];
 moduleFrom('supabase/functions/trigger-scheduled-reports/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>state.db},'../_shared/reports/payloads.ts':payloadModule(),'../_shared/auth/secretEquals.ts':{secretEquals:async()=>options.authorized!==false}},{Deno:{env:{get:()=> 'https://fixture.invalid'},serve:f=>handler=f},fetch:async(url,opts)=>{
  requests.push({url,headers:opts.headers,payload:JSON.parse(opts.body),newCompetitiveStatus:state.tables.competitive_reports.at(-1).status});
  if(url.includes('refresh-competitor-feed'))return new Response(JSON.stringify(options.feedResponse || {error:'Fixture landscape missing'}),{status:options.feedStatus || 422});
  if(options.transport==='throw')throw Error('Fixture network failure');
  if(options.transport==='reject')return new Response('{}',{status:503});
  if(options.immediate && url.endsWith('/competitive'))Object.assign(state.tables.competitive_reports.at(-1),{status:'complete',report_data:{ai_analysis:{executive_summary:'Fresh analysis'}}});
  return new Response(JSON.stringify({accepted:true}),{status:200});
 }});
 const response=await handler(new Request('https://fixture.invalid/scheduler'+(options.dryRun?'?dry_run=1':''),{method:'POST',body:JSON.stringify(options.body||{})}));return{...state,requests,status:response.status,body:await response.json()};
}
async function runFeed({landscapes,explicit,posts=[],providerStatus=200}) {
 const state=database({due:false});Object.assign(state.tables.clients[0],{name:'Subliy',website_url:'https://subliy.com'});
 if(explicit)state.tables.competitor_sets[0].rivaliq_landscape_id=explicit;
 let handler;const requests=[];
 moduleFrom('supabase/functions/refresh-competitor-feed/index.ts',{
 'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>state.db},
 '../_shared/competitive/rivaliqLandscape.ts':moduleFrom('supabase/functions/_shared/competitive/rivaliqLandscape.ts'),
 '../_shared/auth/requireStaff.ts':{requireStaff:async()=>({})},
 '../_shared/auth/secretEquals.ts':{secretEquals:async()=>true},
 '../_shared/design-prompts/designRefs.ts':{harvestedPaths:()=>[]}
 },{AbortSignal,Deno:{env:{get:n=>n==='ANTHROPIC_API_KEY'?undefined:'fixture'},serve:f=>handler=f},fetch:async url=>{
 requests.push(url);
 if(url.includes('/landscapes?'))return new Response(JSON.stringify({landscapes}),{status:providerStatus});
 if(url.includes('/socialposts?'))return new Response(JSON.stringify({socialPosts:posts}));
 if(url.startsWith('https://fixture.invalid/'))return new Response('',{status:404});
 throw Error('Unexpected outbound call');
 }});
 const response=await handler(new Request('https://fixture.invalid/feed',{method:'POST',body:JSON.stringify({client_id:'fixture-client'})}));
 return {...state,requests,status:response.status,body:await response.json()};
}
async function setupPreview({authorized=true,canWrite=true,mode='preview',website='https://client.com',fingerprint='wrong',status='confirmed'}={}) {
 const state=database({due:false});state.tables.clients[0].website_url=website;state.tables.competitor_sets[0].status=status;
 state.tables.competitors=['one','two','three'].map((n,i)=>({id:n,set_id:'fixture-set',name:n,website_url:'https://'+n+'.com',is_selected:true,selected_rank:i+1}));
 let handler;let outbound=0;class AuthzError extends Error {constructor(status,message){super(message);this.status=status;}}
 moduleFrom('supabase/functions/setup-rivaliq-landscape/index.ts',{
 'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>state.db},
 '../_shared/auth/requireStaff.ts':{AuthzError,requireStaff:async()=>{if(!authorized)throw new AuthzError(401,'Unauthorized');return{asCaller:{rpc:async()=>({data:canWrite,error:null})}};}},
 '../_shared/competitive/rivaliqSetup.ts':moduleFrom('supabase/functions/_shared/competitive/rivaliqSetup.ts')
 },{crypto:require('node:crypto').webcrypto,TextEncoder,Deno:{env:{get:()=> 'fixture'},serve:f=>handler=f},fetch:async()=>{outbound++;throw Error('Unexpected provider call')}});
 const r=await handler(new Request('https://fixture.invalid/setup',{method:'POST',body:JSON.stringify({set_id:'fixture-set',mode,fingerprint})}));
 return{status:r.status,body:await r.json(),state,outbound};
}
async function runImport({matches=true}={}) {
 const state=database({due:false});Object.assign(state.tables.clients[0],{name:'Subliy',website_url:'https://subliy.com'});
 state.tables.competitors=[];state.tables.competitor_handles=[];
 let handler;const companies=[{id:1,name:'Jobber',url:'https://getjobber.com'}];if(matches)companies.push({id:2,name:'Subliy',url:'https://subliy.com'});
 class AuthzError extends Error{}
 moduleFrom('supabase/functions/import-rivaliq-landscape/index.ts',{
 'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>state.db},
 '../_shared/auth/requireStaff.ts':{AuthzError,requireStaff:async()=>({userId:'fixture-user',asCaller:{rpc:async()=>({data:true,error:null})}})},
 '../_shared/competitive/rivaliqLandscape.ts':moduleFrom('supabase/functions/_shared/competitive/rivaliqLandscape.ts')
 },{Deno:{env:{get:()=> 'fixture'},serve:f=>handler=f},fetch:async()=>new Response(JSON.stringify({landscapes:[{id:42,name:'Fixture',focusCompanyId:1,companies}]}))});
 const r=await handler(new Request('https://fixture.invalid/import',{method:'POST',body:JSON.stringify({client_id:'fixture-client',mode:'import',landscape_id:'42'})}));
 return{status:r.status,body:await r.json(),state};
}
async function runManual(transport, options={}){
 const state=options.state || database();let handler;let dispatches=0;const sentHeaders=[];
 class AuthzError extends Error{constructor(status,message){super(message);this.status=status;}}
 moduleFrom('supabase/functions/run-report/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>state.db},'../_shared/auth/requireStaff.ts':{AuthzError,requireStaff:async()=>({userId:'fixture-user'})},'../_shared/reports/payloads.ts':payloadModule(),'../_shared/competitive/rivaliqLandscape.ts':options.landscapes ? moduleFrom('supabase/functions/_shared/competitive/rivaliqLandscape.ts') : {bestLandscapeMatch(){},summarizeLandscapes(){}},'../_shared/competitive/extractSocialHandles.ts':moduleFrom('supabase/functions/_shared/competitive/extractSocialHandles.ts')},{Deno:{env:{get:n=>n==='SOCIALYTICS_N8N_SECRET'&&options.missingDispatchSecret?undefined:'fixture'},serve:f=>handler=f},fetch:async(url,opts)=>{if(options.provider429 && url.startsWith('https://api.rivaliq.com/'))return new Response('HourRateLimitExceeded',{status:429});if(options.landscapes && url.startsWith('https://api.rivaliq.com/v3/landscapes'))return new Response(JSON.stringify({landscapes:options.landscapes}));sentHeaders.push(opts.headers);dispatches++;if(transport==='late-completed'){state.tables.reports.at(-1).status='completed';throw new Error('Timeout after callback')};if(transport==='throw')throw new Error('Fixture network failure');return new Response('{}',{status:transport==='reject'?503:200})}});
 const response=await handler(new Request('https://fixture.invalid/run',{method:'POST',body:JSON.stringify(options.body || {client_id:'fixture-client',kind:'social',date_range_start:'2026-09-01',date_range_end:'2026-09-15'})}));
 return{state,dispatches,sentHeaders,status:response.status,body:await response.json(),reportStatus:state.tables.reports.at(-1)?.status};
}

async function runCallback(state,kind,status,reportId,{authorized=true,resume=true}={}){
 let handler;const requests=[];
 moduleFrom('supabase/functions/update-'+(kind==='competitive'?'competitive-':'')+'report/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>state.db},'../_shared/auth/secretEquals.ts':{secretEquals:async()=>authorized}},{Deno:{env:{get:()=> 'https://fixture.invalid'},serve:f=>handler=f},fetch:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});if(!resume)throw Error('Scheduler unavailable');const r=await runScheduler({state,body:JSON.parse(opts.body)});return new Response(JSON.stringify(r.body),{status:r.status});}});
 const response=await handler(new Request('https://fixture.invalid/callback',{method:'POST',body:JSON.stringify({op:'report',report_id:reportId,status,report_data:{ai_analysis:{executive_summary:'Completed fixture'}}})}));
 return{status:response.status,body:await response.json(),requests};
}
async function detectHandlesQa({html='',existing=[],readError=false,fetchMode='ok',writeError=false}={}) {
 let handler;const writes=[],requests=[];
 const db={from(table){const q={select(){return q},update(){return q},eq(){return q},in(){return q},async upsert(value){writes.push(value);return{error:writeError?{message:'fixture save failed'}:null}},then(resolve,reject){return Promise.resolve(table==='competitors'?{data:[{id:'rival',client_id:'client',name:'Acme',website_url:'https://acme.example'}],error:null}:{data:existing,error:readError?{message:'fixture read error'}:null}).then(resolve,reject)}};return q}};
 moduleFrom('supabase/functions/detect-competitor-handles/index.ts',{
  'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},
  '../_shared/auth/requireStaff.ts':{AuthzError:class extends Error{},requireStaff:async()=>({asCaller:{rpc:async()=>({data:true,error:null})}})},
  '../_shared/competitive/extractSocialHandles.ts':moduleFrom('supabase/functions/_shared/competitive/extractSocialHandles.ts'),
 },{Deno:{env:{get:()=> 'fixture'},serve:f=>handler=f},AbortSignal,fetch:async(url,opts)=>{requests.push(url);assert.ok(opts.signal,'Every website request has a deadline');if(fetchMode==='failed')return new Response('',{status:403});if(fetchMode==='partial'&&url.includes('firecrawl'))return new Response('',{status:503});if(url.includes('/search'))return new Response(JSON.stringify({data:[{url:'https://instagram.com/popular/'},{url:'https://tiktok.com/@unrelated'}]}));if(url.includes('firecrawl'))return new Response(JSON.stringify({data:{rawHtml:'',links:[]}}));return new Response(html);}});
 const r=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({competitor_id:'rival',refresh:true})}));return{status:r.status,body:await r.json(),writes,requests};
}

async function identifySitesQa(validCount) {
 let handler;const writes=[];
 const proposed=Array.from({length:4},(_,i)=>({name:'Company '+i,website_url:'https://site'+i+'.example',rationale:'Fixture',similarity_score:.8}));
 const db={from(table){let payload;const q={select(){return q},eq(){return q},insert(v){payload=v;writes.push({table,payload:v});return q},async maybeSingle(){return{data:{id:'client',name:'Client'},error:null}},async single(){return{data:{id:'set'},error:null}},then(resolve,reject){return Promise.resolve({data:payload,error:null}).then(resolve,reject)}};return q}};
 moduleFrom('supabase/functions/identify-competitors/index.ts',{
  'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},
  '../_shared/auth/requireStaff.ts':{AuthzError:class extends Error{},requireStaff:async()=>({})},
  '../_shared/anthropic.ts':{anthropicMessages:async()=>({text:JSON.stringify({competitors:proposed}),stopReason:'end_turn'})},
  '../_shared/competitive/validateCompetitorWebsites.ts':moduleFrom('supabase/functions/_shared/competitive/validateCompetitorWebsites.ts',{}, {AbortSignal,fetch:async(url)=>{if(Number(url.match(/site(\d+)/)[1])>=validCount)throw new TypeError('DNS');return new Response('<html><title>Company</title><body>'+('Company information '.repeat(20))+'</body></html>')}}),
 },{Deno:{env:{get:()=> 'fixture'},serve:f=>handler=f},AbortSignal});
 const response=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({client_id:'client'})}));
 return{status:response.status,body:await response.json(),writes};
}

async function confirmCompetitorsQa({handlesById={},handlesError=false}={}) {
 let handler,updated=false;
 const selected=[1,2,3].map(i=>({id:'competitor-'+i,name:'Competitor '+i,selected_rank:i,set_id:'set'}));
 const db={from(table){const filters=[];let mode='select',payload=null,one=false;const q={
  select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},maybeSingle(){one=true;return q},update(v){mode='update';payload=v;return q},
  then(resolve,reject){let response;
   if(table==='competitor_sets'&&mode==='select')response={data:{id:'set',client_id:'client',status:'draft'},error:null};
   else if(table==='competitors')response={data:selected,error:null};
   else if(table==='competitor_handles'){const id=filters.find(([k])=>k==='competitor_id')?.[1];response={data:handlesById[id]||[],error:handlesError?{message:'fixture handle read failed'}:null};}
   else if(table==='competitor_sets'&&mode==='update'){updated=true;response={data:null,error:null};}
   else response={data:one?null:[],error:null};
   return Promise.resolve(response).then(resolve,reject);
  }};return q}};
 class AuthzError extends Error {}
 moduleFrom('supabase/functions/confirm-competitor-set/index.ts',{
  'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},
  '../_shared/auth/requireStaff.ts':{AuthzError,requireStaff:async()=>({userId:'staff',asCaller:{rpc:async()=>({data:true,error:null})}})},
  '../_shared/competitive/extractSocialHandles.ts':moduleFrom('supabase/functions/_shared/competitive/extractSocialHandles.ts'),
 },{Deno:{env:{get:()=> 'fixture'},serve:f=>handler=f}});
 const response=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({set_id:'set'})}));
 return{status:response.status,body:await response.json(),updated};
}

(async()=>{
 for(const [name,options,header,expected] of [['client rejected',{staff:false},'Bearer fixture',403],['staff allowed',{},'Bearer fixture',null],['expired session rejected',{valid:false},'Bearer fixture',401],['missing session rejected',{},null,401],['role error fails closed',{roleError:true},'Bearer fixture',500]])await check('QA-13','control','actual staff guard: '+name,async()=>{const g=actualStaffGuard(options);const response=await g.staffGate(new Request('https://fixture.invalid',{headers:header?{Authorization:header}:{}}),{});assert.equal(response?.status??null,expected);});
 for(const options of [{},{media:['https://fixture.invalid/image.png']},{media:['a','b'],partial:true},{media:['a'],uploadFailure:true},{recordFailure:true},{providerFailure:true},{missing:true},{denied:true}])await check('QA-01','regression','publishing '+JSON.stringify(options),async()=>{const r=await scheduling(options);assert.equal(r.status,options.denied?401:options.missing?400:options.uploadFailure?502:options.providerFailure?500:200);assert.equal(r.calls.filter(x=>x==='publish').length,options.denied||options.missing||options.uploadFailure?0:1);if(options.recordFailure)assert.equal(r.body.recorded,false);if(options.partial)assert.equal(r.body.media_dropped,1);});
 for(const status of ['pending','failed','completed'])await check('QA-07','regression',status+' never fabricates a presentation URL',()=>{const r=gamma({status,generationId:'fixture-job'});assert.equal(r.gamma_url,null);assert.equal(r.gamma_status,'failed');assert.equal(r.status,'success');assert.equal(r.warnings.length,1);});
 await check('QA-07','control','completed uses real document URL',()=>{const r=gamma({status:'completed',gammaUrl:'https://gamma.app/docs/fixture-document'});assert.equal(r.gamma_url,'https://gamma.app/docs/fixture-document');assert.equal(r.gamma_status,'success');assert.equal(r.warnings.length,0);});
 await check('QA-07','control','missing analysis is a report failure',()=>assert.equal(gamma({status:'failed'},{}).status,'failed'));
 await check('QA-07','regression','timeout retains usable analysis with warning',()=>{const r=gamma({status:'pending',_gamma_timeout:true});assert.equal(r.status,'success');assert.equal(r.gamma_status,'timed_out');assert.match(r.warnings[0],/timed out/);});
 for(const [start,end,count,days,cadence] of [['2026-09-09','2026-09-15',16,7,16],['2024-02-01','2024-02-29',29,29,7],['2026-09-09','2026-09-09',7,1,49],['2026-09-09','2026-09-15',0,7,0]])await check('QA-08','regression','inclusive cadence '+start+' '+end,()=>{const r=aggregate(start,end,count);assert.equal(r.period.days,days);assert.equal(r.companies[0].cadence_per_week,cadence);});
 for(const order of [['competitive','social'],['social','competitive']])await check('QA-10','regression','hold social until fresh competitive completes '+order,async()=>{const r=await runScheduler({order});assert.equal(r.status,200);assert.equal(r.requests.filter(x=>x.url.endsWith('/social')).length,0);assert.equal(r.body.triggered,1);const comp=r.tables.competitive_reports.at(-1);assert.equal(comp.status,'running');const schedule=r.tables.report_schedules.find(x=>x.report_kind==='social');assert.equal(schedule.pending_competitive_report_id,comp.id);assert.equal(schedule.next_run_at,'2020-01-01T00:00:00Z');comp.status='complete';comp.report_data={ai_analysis:{executive_summary:'Fresh cycle'}};const resumed=await runScheduler({state:r,body:{resume_competitive_report_id:comp.id}});assert.equal(resumed.body.triggered,1);const social=resumed.requests.find(x=>x.url.endsWith('/social'));assert.equal(social.payload.competitive_report_id,comp.id);assert.equal(social.payload.competitive_context.executive_summary,'Fresh cycle');assert.equal(schedule.pending_competitive_report_id,null);const duplicate=await runScheduler({state:r,body:{resume_competitive_report_id:comp.id}});assert.equal(duplicate.requests.length,0);});
 await check('QA-10','control','social-only schedule still runs',async()=>{const r=await runScheduler({order:['social']});assert.equal(r.body.triggered,1);assert.equal(r.requests[0].payload.competitive_report_id,'old-complete');});
 await check('QA-10','control','immediate competitive completion uses fresh result',async()=>{const r=await runScheduler({immediate:true});assert.equal(r.body.triggered,2);assert.equal(r.requests[1].payload.competitive_context.executive_summary,'Fresh analysis');});
 await check('QA-10','control','missing competitor set holds both due schedules',async()=>{const state=database();state.tables.competitor_sets=[];const r=await runScheduler({state});assert.equal(r.requests.length,0);assert(r.tables.report_schedules.every(x=>x.next_run_at==='2020-01-01T00:00:00Z'));});
 await check('QA-10','control','already claimed schedule is not dispatched',async()=>{const state=database({order:['social']});state.tables.report_schedules[0].dispatch_claimed_at='2026-09-01';const r=await runScheduler({state});assert.equal(r.requests.length,0);assert.equal(r.body.triggered,0);});
 await check('QA-10','control','dry run makes no writes or outbound calls',async()=>{const r=await runScheduler({dryRun:true,feedError:true});assert.equal(r.operations.length,0);assert.equal(r.requests.length,0);assert.equal(r.body.triggered,0);});
 await check('QA-10','control','wrong secret is rejected before writes',async()=>{const r=await runScheduler({authorized:false});assert.equal(r.status,401);assert.equal(r.operations.length,0);assert.equal(r.requests.length,0);});
 await check('QA-10','control','explicit dependency cannot use another client report',async()=>{const state=database();state.tables.competitive_reports[0].client_id='other';await assert.rejects(()=>payloadModule().buildSocialPayload({supabase:state.db,client:state.tables.clients[0],reportId:'fixture',range:{},competitiveReportId:'old-complete'}),/required competitive/);});
 await check('QA-11','regression','failed feed returns a failing scheduler response',async()=>{const r=await runScheduler({due:false,feedError:true});assert.equal(r.status,502);assert.equal(r.body.failed,1);assert.equal(r.body.triggered,0);});
 for(const feedStatus of [401,403,429,500,502]) await check('QA-11','regression','real feed failure stays visible '+feedStatus,async()=>{const r=await runScheduler({due:false,feedError:true,feedStatus,feedResponse:{error:'Provider failed',code:'RIVALIQ_CLIENT_NOT_TRACKED'}});assert.equal(r.status,502);assert.equal(r.body.failed,1);});
 await check('QA-11','regression','missing tracking is explicit configuration status without gateway failure',async()=>{const r=await runScheduler({due:false,feedError:true,feedResponse:{code:'RIVALIQ_CLIENT_NOT_TRACKED',error:'Client missing'}});assert.equal(r.status,200);assert.equal(r.body.status,'configuration_required');assert.equal(r.body.configuration_required,1);assert.equal(r.body.failed,0);assert.equal(r.body.feeds[0].error,'Client missing');assert.equal(r.operations.length,0);});
 await check('QA-11','regression','missing feed tracking does not prevent a due social dispatch',async()=>{const r=await runScheduler({order:['social'],feedError:true,feedResponse:{code:'RIVALIQ_CLIENT_NOT_TRACKED',error:'Client missing'}});assert.equal(r.status,200);assert.equal(r.body.triggered,1);assert.equal(r.body.configuration_required,1);});
 for(const explicit of [null,'612909']) await check('QA-FEED','regression','unrelated Subliy landscape rejected before all writes '+explicit,async()=>{const r=await runFeed({explicit,landscapes:[{id:612909,name:'Subliy',focusCompanyId:1,companies:[{id:1,name:'Jobber',url:'https://getjobber.com'}]}]});assert.equal(r.status,422);assert.equal(r.body.code,'RIVALIQ_CLIENT_NOT_TRACKED');assert.equal(r.requests.length,1);assert.equal(r.operations.length,0);});
 await check('QA-FEED','regression','ambiguous identity is rejected before writes',async()=>{const r=await runFeed({explicit:'1',landscapes:[{id:1,focusCompanyId:1,companies:[{id:1,name:'Subliy',url:'https://subliy.com'},{id:2,name:'Subliy LLC',url:'https://another.com'}]}]});assert.equal(r.status,422);assert.equal(r.operations.length,0);});
 await check('QA-FEED','regression','provider failure remains an error with no writes',async()=>{const r=await runFeed({landscapes:[],providerStatus:429});assert.equal(r.status,500);assert.equal(r.body.code,undefined);assert.equal(r.operations.length,0);});
 await check('QA-FEED','regression','non-focus client harvest uses client identity, never focus company',async()=>{const r=await runFeed({explicit:'1',landscapes:[{id:1,focusCompanyId:1,companies:[{id:1,name:'Jobber',url:'https://getjobber.com'},{id:2,name:'Subliy',url:'https://subliy.com'}]}],posts:[{companyId:1,postId:'rival',image:'https://fixture.invalid/rival.jpg'},{companyId:2,postId:'client',image:'https://fixture.invalid/client.jpg'}]});assert.equal(r.status,200);assert.equal(r.body.posts,2);assert(r.requests.includes('https://fixture.invalid/client.jpg'));assert(!r.requests.includes('https://fixture.invalid/rival.jpg'));assert.equal(r.requests.filter(u=>u.includes('/landscapes?')).length,1);});
 for(const [options,status] of [[{authorized:false},401],[{canWrite:false},403],[{status:'draft'},409],[{status:'analyzing'},409],[{website:'https://nd-main-qa.moburst.org'},422],[{mode:'advance'},409]]) await check('QA-SETUP','regression','provider setup gate '+JSON.stringify(options),async()=>{const r=await setupPreview(options);assert.equal(r.status,status);assert.equal(r.outbound,0);assert.equal(r.state.operations.length,0);});
 await check('QA-SETUP','control','review contains client and three confirmed URLs without writes',async()=>{const r=await setupPreview();assert.equal(r.status,200);assert.equal(r.body.plan.companies.length,4);assert.equal(r.body.plan.companies[0].url,'https://client.com/');assert.match(r.body.fingerprint,/^[a-f0-9]{64}$/);assert.equal(r.outbound,0);assert.equal(r.state.operations.length,0);});
 await check('QA-IMPORT','regression','unrelated landscape cannot create a competitor set',async()=>{const r=await runImport({matches:false});assert.equal(r.status,422);assert.equal(r.state.operations.length,0);});
 await check('QA-IMPORT','regression','non-focus client is excluded and focus competitor retained',async()=>{const r=await runImport();assert.equal(r.status,200);assert.equal(r.state.tables.competitors.length,1);assert.equal(r.state.tables.competitors[0].name,'Jobber');});
 await check('QA-04','regression','manual dispatch includes workflow authentication',async()=>{const r=await runManual('accept');assert.equal(r.status,200);assert.equal(r.sentHeaders[0]['X-Socialytics-Secret'],'fixture');});
 await check('QA-04','regression','missing workflow secret cannot create or dispatch reports',async()=>{const r=await runManual('accept',{missingDispatchSecret:true});assert.equal(r.status,503);assert.equal(r.dispatches,0);assert.equal(r.state.operations.length,0);});
 await check('QA-04','regression','both scheduled dispatch types carry workflow authentication',async()=>{const r=await runScheduler({immediate:true});assert.equal(r.body.triggered,2);assert(r.requests.every(q=>q.headers['X-Socialytics-Secret']==='https://fixture.invalid'));});
 for(const transport of ['throw','reject'])await check('QA-11','regression','failed scheduler dispatch '+transport,async()=>{const r=await runScheduler({order:['social'],transport});assert.equal(r.status,502);assert.equal(r.tables.reports[0].status,'failed');assert.equal(r.body.triggered,0);});
 for(const transport of ['throw','reject','accept','late-completed'])await check('QA-11','regression','manual dispatch '+transport,async()=>{const r=await runManual(transport);assert.equal(r.status,transport==='reject'?502:transport==='accept'?200:500);assert.equal(r.reportStatus,transport==='accept'?'running':transport==='late-completed'?'completed':'failed');});

 await check('QA-10','regression','actual completion callback resumes the pinned social schedule',async()=>{const r=await runScheduler();const id=r.tables.competitive_reports.at(-1).id;const callback=await runCallback(r,'competitive','complete',id);assert.equal(callback.status,200);assert.equal(callback.requests[0].body.resume_competitive_report_id,id);assert.equal(r.tables.reports.length,1);await runCallback(r,'competitive','complete',id);assert.equal(r.tables.reports.length,1);});
 await check('QA-10','regression','failed competitive dependency blocks social with visible failure',async()=>{const r=await runScheduler();r.tables.competitive_reports.at(-1).status='failed';const blocked=await runScheduler({state:r});assert.equal(blocked.status,502);assert.equal(blocked.requests.length,0);assert.equal(r.tables.reports.length,0);assert.equal(r.tables.report_schedules.find(s=>s.report_kind==='social').next_run_at,'2020-01-01T00:00:00Z');});
 await check('QA-10','control','callback scheduler failure preserves completed competitive report',async()=>{const r=await runScheduler();const id=r.tables.competitive_reports.at(-1).id;const callback=await runCallback(r,'competitive','complete',id,{resume:false});assert.equal(callback.status,200);assert(callback.body.warning);assert.equal(r.tables.competitive_reports.at(-1).status,'complete');assert.equal(r.tables.reports.length,0);});
 await check('QA-11','regression','social failure callback closes running row',async()=>{const state=database();state.tables.reports.push({id:'fixture',status:'running'});const callback=await runCallback(state,'social','failed','fixture');assert.equal(callback.status,200);assert.equal(state.tables.reports[0].status,'failed');});
 await check('QA-11','regression','late social failure cannot erase a completed report',async()=>{const state=database();state.tables.reports.push({id:'fixture',status:'completed',report_data:{keep:'original'}});const callback=await runCallback(state,'social','failed','fixture');assert.equal(callback.status,200);assert.equal(state.tables.reports[0].status,'completed');assert.equal(state.tables.reports[0].report_data.keep,'original');});
 await check('QA-11','control','unauthorized callback cannot change report',async()=>{const state=database();state.tables.reports.push({id:'fixture',status:'running'});const callback=await runCallback(state,'social','failed','fixture',{authorized:false});assert.equal(callback.status,401);assert.equal(state.tables.reports[0].status,'running');});
 await check('QA-10','regression','delayed completion retains the competitive report period',async()=>{const r=await runScheduler();const comp=r.tables.competitive_reports.at(-1);comp.status='complete';comp.date_range_start='2026-07-01';comp.date_range_end='2026-07-31';const resumed=await runScheduler({state:r,body:{resume_competitive_report_id:comp.id}});assert.equal(resumed.requests[0].payload.date_range_start,'2026-07-01');assert.equal(resumed.requests[0].payload.date_range_end,'2026-07-31');});
 for (const kind of ['social','competitive']) {
  const table=kind==='social'?'reports':'competitive_reports';
  for (const status of ['running','failed']) for (const age of [10,15,45,89]) await check('QA-90','regression',kind+' '+status+' retry locked at '+age+' minutes',async()=>{
    const state=database(); state.tables[table].push({id:'retry-fixture',client_id:'fixture-client',status,created_at:new Date(Date.now()-age*60000).toISOString()});
    const r=await runManual('accept',{state,body:{report_id:'retry-fixture'}});assert.equal(r.status,409);assert.equal(r.dispatches,0);assert.equal(state.tables[table].at(-1).status,status);
  });
  await check('QA-90','regression',kind+' fresh start resumes active run without dispatch',async()=>{
    const state=database();state.tables[table].push({id:'active-fixture',client_id:'fixture-client',status:'running',created_at:new Date().toISOString()});
    const r=await runManual('accept',{state,body:{client_id:'fixture-client',kind}});assert.equal(r.status,200);assert.equal(r.body.report_id,'active-fixture');assert.equal(r.body.resumed,true);assert.equal(r.dispatches,0);
  });
 }
 for(const status of ['running','failed']) await check('QA-90','control','social '+status+' may retry after 90 minutes',async()=>{
  const state=database();state.tables.reports.push({id:'old-fixture',client_id:'fixture-client',status,created_at:new Date(Date.now()-91*60000).toISOString()});
  const r=await runManual('accept',{state,body:{report_id:'old-fixture'}});assert.equal(r.status,200);assert.equal(r.dispatches,1);assert.equal(state.tables.reports.length,1);
 });
 for(const explicit of [false,true]) await check('QA-IDENTITY','regression','competitive rejects unrelated client before writes, explicit landscape '+explicit,async()=>{
  const state=database();Object.assign(state.tables.clients[0],{name:'Subliy',website_url:'https://www.subliy.com'});
  if(explicit)state.tables.competitor_sets[0].rivaliq_landscape_id='612909';
  const landscapes=[{id:612909,name:'Subliy',focusCompanyId:1955162,companies:[{id:1955162,name:'Jobber',url:'https://getjobber.com'}]}];
  const before=state.tables.competitive_reports.length;
  const r=await runManual('accept',{state,landscapes,body:{client_id:'fixture-client',kind:'competitive',date_range_start:'2026-09-10',date_range_end:'2026-09-16'}});
  assert.equal(r.status,422);assert.match(r.body.error,/No RivalIQ landscape tracks Subliy/);assert.equal(r.dispatches,0);assert.equal(state.tables.competitive_reports.length,before);assert.equal(state.operations.length,0);
 });
 await check('QA-HANDLES','regression','identification preserves existing drafts when fewer than three sites are reachable',async()=>{const r=await identifySitesQa(2);assert.equal(r.status,422);assert.equal(r.writes.length,0);assert.equal(r.body.rejected.length,2);});
 await check('QA-HANDLES','control','identification saves reachable candidates and excludes failed AI domains',async()=>{const r=await identifySitesQa(3);assert.equal(r.status,200);assert.equal(r.writes.find(w=>w.table==='competitors').payload.length,3);assert.equal(r.body.rejected.length,1);});
 await check('QA-EVIDENCE','regression','report callback withholds unsupported absence claims while preserving provider measurements',async()=>{const r=await competitiveWritebackQa();assert.equal(r.status,200);const rd=r.state.tables.competitive_reports[0].report_data;assert.equal(rd.ai_analysis.gaps_for_client.length,0);assert.equal(rd.aggregates.companies[0].rivaliq_metrics.posts.current,0);assert.doesNotMatch(rd.schema_note,/does not establish/);});
 await check('QA-EVIDENCE','regression','partial windows are held instead of released as complete',async()=>{const r=await competitiveWritebackQa({failedWindows:1});const rd=r.state.tables.competitive_reports[0].report_data;assert.match(rd.schema_note,/1 of 5/);assert.equal(r.state.tables.competitive_reports[0].status,'failed');assert.equal(rd.quality_check.state,'needs_review');assert.doesNotMatch(rd.schema_note,/does not establish/);assert.equal(rd.ai_analysis.gaps_for_client.length,0);});
 await check('QA-EVIDENCE','regression','mismatched post totals cannot be released or linked to a presentation',async()=>{const r=await competitiveWritebackQa({periodTotal:5});const row=r.state.tables.competitive_reports[0];assert.equal(row.status,'failed');assert.equal(row.gamma_url,null);assert.equal(row.report_data.quality_check.state,'needs_review');});
 await check('QA-EVIDENCE','control','callback secret rejection and raw snapshot storage remain intact',async()=>{const denied=await competitiveWritebackQa({authorized:false});assert.equal(denied.status,401);assert.equal(denied.state.operations.length,0);const snap=await competitiveWritebackQa({op:'snapshot'});assert.equal(snap.status,200);assert.deepEqual(snap.state.tables.rivaliq_snapshots.at(-1).payload,{status:2});});
 await check('QA-HANDLES','regression','failed website lookup is not reported as a completed empty search',async()=>{const r=await detectHandlesQa({fetchMode:'failed'});assert.equal(r.body.results[0].status,'failed');assert.match(r.body.results[0].warnings.join(' '),/403/);assert.equal(r.writes.length,0);});
 await check('QA-HANDLES','regression','rendered lookup failure is disclosed as partial when direct pages worked',async()=>{const r=await detectHandlesQa({fetchMode:'partial'});assert.equal(r.body.results[0].status,'partial');assert.match(r.body.results[0].warnings.join(' '),/503/);});
 await check('QA-HANDLES','control','completed empty lookup is distinguished from provider failure',async()=>{const r=await detectHandlesQa();assert.equal(r.body.results[0].status,'not_found');assert.equal(r.body.results[0].warnings.length,0);});
 await check('QA-HANDLES','regression','save failure returns write errors instead of a false found result',async()=>{const r=await detectHandlesQa({html:'<footer><a href="https://instagram.com/acme">Acme</a></footer>',writeError:true});assert.equal(r.body.results[0].detected.length,0);assert.equal(r.body.write_errors.length,1);});
 await check('QA-HANDLES','regression','empty company site cannot adopt unrelated search profiles',async()=>{const r=await detectHandlesQa();assert.equal(r.status,200);assert.equal(r.writes.length,0);assert.equal(r.requests.some(url=>url.includes('/search')),true);});
 for(const source of ['manual','rivaliq','rejected']) await check('QA-HANDLES','regression','refresh preserves '+source+' decisions',async()=>{const r=await detectHandlesQa({html:'<footer><a href="https://instagram.com/acme">Acme</a></footer>',existing:[{competitor_id:'rival',platform:'instagram',source}]});assert.equal(r.status,200);assert.equal(r.writes.length,0);});
 await check('QA-HANDLES','regression','failed protection lookup aborts before overwriting handles',async()=>{const r=await detectHandlesQa({html:'https://instagram.com/acme',readError:true});assert.equal(r.status,500);assert.equal(r.writes.length,0);assert.equal(r.requests.length,0);});
 await check('QA-HANDLES','control','company site profile still saves after discovery-page rejection',async()=>{const r=await detectHandlesQa({html:'<footer><a href="https://instagram.com/popular/">Popular</a><a href="https://instagram.com/acme/">Acme</a></footer>'});assert.equal(r.status,200);assert.equal(r.writes.length,1);assert.equal(r.writes[0].handle,'acme');});
 await check('QA-HANDLES','regression','confirmation rejects competitors backed only by weak automatic guesses',async()=>{const weak=Object.fromEntries([1,2,3].map(i=>['competitor-'+i,[{source:'auto',detection_confidence:0.45,is_active:true}]]));const r=await confirmCompetitorsQa({handlesById:weak});assert.equal(r.status,422);assert.match(r.body.error,/low-confidence automatic profiles/);assert.equal(r.updated,false);});
 await check('QA-HANDLES','control','confirmation accepts reviewed and strongly evidenced profiles',async()=>{const ready={
  'competitor-1':[{source:'manual',detection_confidence:1,is_active:true}],
  'competitor-2':[{source:'rivaliq',detection_confidence:null,is_active:true}],
  'competitor-3':[{source:'auto',detection_confidence:0.8,is_active:true}],
 };const r=await confirmCompetitorsQa({handlesById:ready});assert.equal(r.status,200);assert.equal(r.updated,true);});
 await check('QA-HANDLES','regression','confirmation fails closed when handle verification cannot be read',async()=>{const r=await confirmCompetitorsQa({handlesError:true});assert.equal(r.status,500);assert.equal(r.updated,false);});
 await check('QA-RIVALIQ','regression','hourly limit refuses dispatch without creating a report',async()=>{const state=database({due:false});const before=state.tables.competitive_reports.length;const r=await runManual('accept',{state,provider429:true,body:{client_id:'fixture-client',kind:'competitive'}});assert.equal(r.status,429);assert.equal(r.body.code,'RIVALIQ_BUSY');assert.equal(r.dispatches,0);assert.equal(state.tables.competitive_reports.length,before);});
 await check('QA-HANDLES','regression','legacy confirmed set with weak profiles cannot start analysis',async()=>{const state=database({due:false});state.tables.competitor_handles.forEach(h=>h.detection_confidence=.45);const before=state.tables.competitive_reports.length;const r=await runManual('accept',{state,body:{client_id:'fixture-client',kind:'competitive'}});assert.equal(r.status,422);assert.match(r.body.error,/low-confidence automatic profiles/);assert.equal(r.dispatches,0);assert.equal(state.tables.competitive_reports.length,before);});
 for (const [start,end] of [['2026-08-31','2026-08-01'],['2026-02-30','2026-03-02'],['2026-01-01','2099-01-01'],['2024-01-01','2026-01-01'],['2026-01-01','']]) await check('QA-DATE','regression','reject invalid competitive dates '+start+' / '+end,async()=>{
  const r=await runManual('accept',{body:{client_id:'fixture-client',kind:'competitive',date_range_start:start,date_range_end:end}});assert.equal(r.status,400);assert.equal(r.dispatches,0);assert.equal(r.state.operations.filter(x=>x.mode==='insert').length,0);
 });
 const report={checks:results.length,passed:results.filter(x=>x.result==='pass').length,failed:results.filter(x=>x.result==='FAIL')};
 console.log(JSON.stringify(report,null,2));if(report.failed.length)process.exitCode=1;
})();
