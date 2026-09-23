const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=name=>fs.readFileSync('n8n/code/'+name+'.js','utf8');
const output=[];function check(name,fn){fn();output.push(name)}
const profiles=[{id:5034995,network:'facebook'},{id:5489335,network:'fb_instagram_account'},{id:5719052,network:'linkedin_company'}];
const august=[{impressions:961,reactions:5,likes:5,comments_count:0,shares_count:0,post_link_clicks:1,post_content_clicks:14,post_content_clicks_other:13,video_views:120,posts_sent_count:3},{impressions:783,reactions:6,likes:6,comments_count:1,shares_count:0,video_views:15,posts_sent_count:1},{impressions:7929,reactions:110,comments_count:4,shares_count:2,post_link_clicks:599,post_content_clicks:599,video_views:446,posts_sent_count:14}];
const july=[{impressions:982,reactions:2,comments_count:0,shares_count:0,post_link_clicks:1,post_content_clicks_other:5,video_views:108,posts_sent_count:3},{impressions:2193,reactions:18,likes:18,comments_count:0,shares_count:0,saves:6,video_views:14,posts_sent_count:7},{impressions:8924,reactions:95,comments_count:12,shares_count:3,post_link_clicks:1117,post_content_clicks:1117,video_views:214,posts_sent_count:15}];
const pages=(metrics,date)=>[{json:{data:metrics.map((m,i)=>({dimensions:{customer_profile_id:profiles[i].id,'reporting_period.by(day)':date},metrics:m})),paging:{current_page:1,total_pages:1}}}];
const base={'Combine Brief Context with Client Data':[{json:{date_ranges:{current_month:{start:'2026-08-01',end:'2026-08-31'},previous_month:{start:'2026-07-01',end:'2026-07-31'}}}}],'Code in JavaScript':[{json:{profiles}}],'Get Sprout Social Analytics Data':pages(august,'2026-08-01'),'Get Previous Month Sprout Analytics':pages(july,'2026-07-01'),'Get Sprout Social Post Analytics':[{json:{data:[{guid:'p',perma_link:'https://example.com/post',network:'LINKEDIN',created_time:'2026-08-10T00:00:00Z',metrics:{'lifetime.comments_count':400,'lifetime.shares_count':500,'lifetime.engagements':1000}}]}}],'Get Previous Month Post Analytics':[{json:{data:[]}}]};
function runSocial(nodes=base){return vm.runInNewContext('(function(){'+read('social-aggregate')+'})()',{$input:{all:()=>[]},$:name=>({first:()=>nodes[name]?.[0],all:()=>nodes[name]||[]}),console:{log(){}}})[0].json;}
check('verified August provider totals reconcile with Sprout PDF without lifetime substitution',()=>{const r=runSocial();assert.deepEqual(JSON.parse(JSON.stringify(r.overall_totals)),{impressions:9673,reactions:121,link_clicks:600,video_views:581,comments:5,shares:2,engagements:741});assert.equal(r.month_comparison.previous_month.engagements,1259);assert.equal(r.month_comparison.previous_month.comments,12);assert.equal(r.platform_metrics.LinkedIn.post_count,14);assert.equal(r.platform_metrics.Instagram.comments,1)});
check('reads all pages without double-counting repeated rows',()=>{const n=structuredClone(base);const pages=n['Get Sprout Social Analytics Data'];const data=pages[0].json.data;pages[0].json={data:[data[0]],paging:{current_page:1,total_pages:2}};pages.push({json:{data,paging:{current_page:2,total_pages:2}}});assert.equal(runSocial(n).overall_totals.impressions,9673)});
check('fails visibly when API pagination is incomplete',()=>{const n=structuredClone(base);n['Get Sprout Social Analytics Data'][0].json.paging.total_pages=2;assert.throws(()=>runSocial(n),/not all API pages/)});
check('rejects metrics from outside the selected month',()=>{const n=structuredClone(base);n['Get Sprout Social Analytics Data'][0].json.data[0].dimensions['reporting_period.by(day)']='2026-07-31';assert.throws(()=>runSocial(n),/outside the requested/)});
check('post lifetime metrics remain separate and provider engagements include clicks',()=>{const r=runSocial();assert.equal(r.top_posts[0].engagements,1000);assert.equal(r.top_posts[0].metric_scope,'lifetime');assert.equal(r.metric_scope,'reporting_period')});
function runCompetitive(overrides={}){
 const nodes={'Run Config':{range_start:'2026-08-01',range_end:'2026-08-31',client_name:'Fixture'},'Resolve Landscape':{focus_company_id:1},'Landscape Companies':{companies:[{id:1,name:'Fixture'}]},'Landscape Metrics Summary':{metrics:[{companyId:1,mainPeriodStart:'2026-08-01T00:00:00Z',mainPeriodEnd:'2026-08-31T23:59:59Z'}]},...overrides};
 const input=overrides.input||{socialPosts:[{postId:'1',companyId:1,publishedAt:'2026-08-31T23:59:59Z'},{postId:'1',companyId:1,publishedAt:'2026-08-31T23:59:59Z'},{postId:'2',companyId:1,publishedAt:'2026-09-01T00:00:00Z'}]};
 return vm.runInNewContext('(function(){'+read('competitive-aggregate')+'})()',{$input:{first:()=>({json:input})},$:name=>({first:()=>({json:nodes[name]||{}})})})[0].json;
}
check('RivalIQ includes end date, excludes next date, deduplicates posts',()=>assert.equal(runCompetitive().total_posts_analyzed,1));
check('RivalIQ unavailable audience remains null while measured zero remains zero',()=>{
 const r=runCompetitive({'Landscape Metrics Summary':{metrics:[{companyId:1,mainPeriodStart:'2026-08-01',mainPeriodEnd:'2026-08-31',crossChannelSocialAudience:null,instagramFollowedBy:null,crossChannelSocialActivity:0,instagramPosts:0}]}});
 const m=r.companies[0].rivaliq_metrics;
 assert.equal(m.audience.current,null);assert.equal(m.posts.current,0);
 assert.equal(m.by_network.instagram.followers.current,null);assert.equal(m.by_network.instagram.posts.current,0);
 assert.equal(m.audience.previous,null);
});
check('RivalIQ missing and invalid metrics are not fabricated as zeros',()=>{
 const r=runCompetitive({'Landscape Metrics Summary':{metrics:[{companyId:1,mainPeriodStart:'2026-08-01',mainPeriodEnd:'2026-08-31',crossChannelSocialAudience:'',crossChannelSocialEngagement:'invalid'}]}});
 assert.equal(r.companies[0].rivaliq_metrics.audience.current,null);
 assert.equal(r.companies[0].rivaliq_metrics.engagement.current,null);
 assert.equal(r.companies[0].rivaliq_metrics.posts.current,null);
});
check('RivalIQ rejects mismatched metric periods',()=>assert.throws(()=>runCompetitive({'Landscape Metrics Summary':{metrics:[{companyId:1,mainPeriodStart:'2026-07-01',mainPeriodEnd:'2026-07-31'}]}}),/different period/));
check('RivalIQ refuses to attribute an unrelated focus company to the client',()=>assert.throws(()=>runCompetitive({'Run Config':{client_name:'Subliy',range_start:'2026-08-01',range_end:'2026-08-31'},'Landscape Companies':{companies:[{id:1,name:'Jobber',url:'https://getjobber.com'}]}}),/CLIENT_IDENTITY_UNVERIFIED/));
check('RivalIQ selects the tracked client even when another company is the focus',()=>{const r=runCompetitive({'Landscape Companies':{companies:[{id:1,name:'Rival'},{id:2,name:'Fixture'}]}});assert.equal(r.companies.find(c=>c.is_client).company_id,'2')});
for(const field of ['failed_windows','truncated_pages'])check('RivalIQ refuses partial '+field,()=>assert.throws(()=>runCompetitive({input:{socialPosts:[],[field]:1}}),/incomplete/));
function resolveClient(companies, selected=[]) {
 const cfg={client_name:'Subliy',landscape_hint:612909,competitors_json:JSON.stringify(selected)};
 return vm.runInNewContext('(function(){'+read('competitive-resolve')+'})()',{$input:{first:()=>({json:{landscapes:[{id:612909,name:'Subliy',focusCompanyId:1955162,companies}]}})},$:name=>({first:()=>({json:name==='Run Config'?cfg:{body:{website_url:'https://www.subliy.com/'}}})})})[0].json;
}
check('actual resolver rejects the observed Subliy landscape containing Jobber as focus',()=>assert.throws(()=>resolveClient([{id:1955162,name:'Jobber',url:'http://getjobber.com/'}]),/CLIENT_IDENTITY_UNVERIFIED/));
check('actual resolver identifies a tracked client independently of the focus company',()=>assert.equal(resolveClient([{id:1955162,name:'Jobber',url:'http://getjobber.com/'},{id:99,name:'Subliy',url:'https://subliy.com'}]).client_company_id,99));
check('resolver rejects a changed selection using an old client landscape',()=>assert.throws(()=>resolveClient([{id:99,name:'Subliy',url:'https://subliy.com'},{id:1,name:'Old rival',url:'https://old.example.com'}],[{name:'New rival',website_url:'https://new.example.com'}]),/TRACKING_SELECTION_MISMATCH/));
check('resolver matches competitor website despite provider company naming',()=>assert.equal(resolveClient([{id:99,name:'Subliy',url:'https://subliy.com'},{id:1,name:'Different legal name',url:'http://www.rival.example.com/'}],[{name:'Rival',website_url:'https://rival.example.com/path'}]).client_company_id,99));
check('resolver rejects stale provider IDs and duplicate competitor identities',()=>{
 const companies=[{id:99,name:'Subliy',url:'https://subliy.com'},{id:1,name:'Rival',url:'https://rival.example.com'}];
 assert.throws(()=>resolveClient(companies,[{name:'Rival',website_url:'https://rival.example.com',rivaliq_company_id:2}]),/TRACKING_SELECTION_MISMATCH/);
 assert.throws(()=>resolveClient(companies,[{name:'Rival'},{name:'Rival'}]),/TRACKING_SELECTION_MISMATCH/);
});
console.log(JSON.stringify({passed:output.length,checks:output},null,2));
