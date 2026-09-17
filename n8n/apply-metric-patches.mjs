import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const code = name => readFileSync(new URL(`./code/${name}.js`, import.meta.url), 'utf8');
export function metricOperations(kind, workflow) {
  const expected = kind === 'social' ? 'a84772c8-721a-4027-9176-9e2ac7b395c7' : 'f849730d-8fc5-4ca4-a17d-8286484690a7';
  if (workflow.versionId !== expected) throw new Error('Workflow changed; rebase the metric patch before applying.');
  const ops=[];
  const update=(nodeName,parameters)=>ops.push({type:'updateNodeParameters',nodeName,parameters,replace:false});
  if(kind==='social') {
    update('Aggregate Sprout Social Data',{jsCode:code('social-aggregate')});
    update('Build Presentation Content',{jsCode:code('social-presentation')});
    update('Generate Run Summary',{jsCode:code('social-summary')});
    for(const name of ['Get Sprout Social Analytics Data','Get Previous Month Sprout Analytics','Get Sprout Social Post Analytics','Get Previous Month Post Analytics']) {
      const node=workflow.nodes.find(n=>n.name===name);if(!node)throw Error('Missing '+name);
      let body=node.parameters.body;
      if(!name.includes('Post Analytics')) body=body.replace('"comments", "shares"','"comments_count", "shares_count", "likes", "post_content_clicks", "post_content_clicks_other", "saves", "story_replies", "posts_sent_count"');
      else body=body.replace('"filters": [','"timezone": $("Combine Brief Context with Client Data").first().json.timezone || "UTC",\n  "filters": [');
      update(name,{contentType:'json',specifyBody:'json',jsonBody:body,options:{...node.parameters.options,pagination:{pagination:{paginationMode:'updateAParameterInEachRequest',parameters:{parameters:[{type:'body',name:'page',value:'={{ $pageCount + 1 }}'}]},paginationCompleteWhen:'other',completeExpression:'={{ !$response.body.paging || Number($response.body.paging.current_page) >= Number($response.body.paging.total_pages) }}',limitPagesFetched:true,maxRequests:100,requestInterval:200}}}});
      const requestOp = ops.at(-1);
      requestOp.parameters = {...node.parameters, ...requestOp.parameters};
      delete requestOp.parameters.body; delete requestOp.parameters.rawContentType;
      requestOp.replace = true;
      ops.push({type:'setNodeSettings',nodeName:name,settings:{executeOnce:true}});
    }
  } else {
    update('Aggregate Competitive Data',{jsCode:code('competitive-aggregate')});
    update('Competitive Output Parser',{autoFix:true,customizeRetryPrompt:true,prompt:'Repair only the JSON structure to match the schema. Preserve all supplied factual values and source URLs; do not invent missing research. Correct field-name typos such as why_itmatters to why_it_matters.\nInstructions: {instructions}\nCompletion: {completion}\nValidation error: {error}'});
    ops.push({type:'addConnection',source:'Analysis Model',target:'Competitive Output Parser',connectionType:'ai_languageModel',sourceIndex:0,targetIndex:0});
  }
  return ops;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [kind,input,output]=process.argv.slice(2);writeFileSync(output,JSON.stringify(metricOperations(kind,JSON.parse(readFileSync(input,'utf8'))),null,2));
}
