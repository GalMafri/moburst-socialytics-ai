import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Build an auditable patch from the currently inspected workflow. No requests
// or publication happen here; credentials remain managed references.
export function metricCoveragePatch(workflow) {
  const find = name => {
    const nodes = workflow.nodes.filter(n => n.name === name);
    if (nodes.length !== 1) throw new Error('Expected one node: ' + name);
    return nodes[0];
  };
  const read = name => readFileSync(new URL(`code/${name}.js`, import.meta.url),'utf8');
  const helpers = ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/competitive/reportMetrics.ts',import.meta.url),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,removeComments:true},
  }).outputText.replace(/^export /gm,'');
  const source = find('Landscape Metrics Summary');
  const snapshot = {
    name:'Landscape Audience Snapshot', type:source.type, typeVersion:source.typeVersion,
    position:[960,-300],credentials:structuredClone(source.credentials),
    parameters:{...structuredClone(source.parameters),queryParameters:{parameters:['mainPeriodStart','mainPeriodEnd'].map(name=>({
      name,value:'={{ DateTime.fromISO($("Run Config").first().json.started_at).toUTC().minus({days:1}).toFormat("yyyy-MM-dd") }}',
    }))}},
  };
  const operations = [];
  if (!workflow.nodes.some(n=>n.name===snapshot.name)) {
    operations.push({type:'addNode',node:snapshot},
      {type:'setNodeSettings',nodeName:snapshot.name,settings:{onError:'continueErrorOutput',retryOnFail:true,maxTries:3,waitBetweenTries:5000}},
      {type:'removeConnection',source:'Landscape Metrics Timeseries',target:'Build Post Windows'},
      {type:'removeConnection',source:'Landscape Metrics Timeseries',target:'Cache Metrics Snapshot'},
      {type:'addConnection',source:'Landscape Metrics Timeseries',target:snapshot.name},
      {type:'addConnection',source:snapshot.name,target:'Build Post Windows'},
      {type:'addConnection',source:snapshot.name,target:'Cache Metrics Snapshot'},
      {type:'addConnection',source:snapshot.name,sourceIndex:1,target:'Mark Report Failed'});
  } else operations.push({type:'updateNodeParameters',nodeName:snapshot.name,parameters:snapshot.parameters,replace:true});
  const cache = structuredClone(find('Cache Metrics Snapshot').parameters);
  cache.jsonBody = '={{ ({ attempt_started_at: $("Run Config").first().json.attempt_started_at, op: "snapshot", client_id: $("Run Config").first().json.client_id, report_id: $("Run Config").first().json.report_id, landscape_id: $("Resolve Landscape").first().json.landscape_id, endpoint: "metrics", payload: { summary: $("Landscape Metrics Summary").first().json, summary_previous: $("Landscape Metrics Summary Previous").first().json, timeseries: $("Landscape Metrics Timeseries").first().json, audience_snapshot: $("Landscape Audience Snapshot").first().json } }) }}';
  operations.push({type:'updateNodeParameters',nodeName:'Cache Metrics Snapshot',parameters:cache,replace:true});
  for(const [nodeName,file,prefix] of [
    ['Aggregate Competitive Data','competitive-aggregate',helpers],
    ['Assemble Report Data','competitive-report',helpers],
    ['Prepare LinkedIn Sources','prepare-linkedin-sources',''],
    ['Merge LinkedIn Posts','merge-linkedin-posts',''],
  ]) operations.push({type:'updateNodeParameters',nodeName,parameters:{...find(nodeName).parameters,jsCode:prefix+'\n'+read(file)},replace:true});
  const ownedHelpers = ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/competitive/ownedMerge.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^export /gm,'');
  const collect={name:'Collect Owned Client Data',type:'n8n-nodes-base.httpRequest',typeVersion:4.3,position:[2240,800],credentials:structuredClone(find('Cache Posts Snapshot').credentials),parameters:{
    method:'POST',url:'https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/competitive-owned-source',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',
    jsonBody:'={{ ({client_id:$("Run Config").first().json.client_id,start:$("Run Config").first().json.range_start,end:$("Run Config").first().json.range_end}) }}',options:{timeout:120000},
  }};
  const merge={name:'Merge Owned Posts',type:'n8n-nodes-base.code',typeVersion:2,position:[2480,800],parameters:{mode:'runOnceForAllItems',jsCode:ownedHelpers+'\n'+read('merge-owned-posts')}};
  for(const node of [collect,merge]) {
    if(workflow.nodes.some(n=>n.name===node.name)) operations.push({type:'updateNodeParameters',nodeName:node.name,parameters:node.parameters,replace:true});
    else operations.push({type:'addNode',node},{type:'setNodeSettings',nodeName:node.name,settings:{onError:'continueErrorOutput',...(node===collect?{retryOnFail:true,maxTries:2,waitBetweenTries:5000}:{})}});
  }
  if(!workflow.nodes.some(n=>n.name===merge.name)) operations.push(
    {type:'removeConnection',source:'Merge LinkedIn Posts',target:'Cache Posts Snapshot'},
    {type:'addConnection',source:'Merge LinkedIn Posts',target:collect.name},
    {type:'addConnection',source:collect.name,target:merge.name},
    {type:'addConnection',source:merge.name,target:'Cache Posts Snapshot'},
    ...[collect,merge].map(n=>({type:'addConnection',source:n.name,sourceIndex:1,target:'Mark Report Failed'})),
  );
  const agent = structuredClone(find('Competitive Analysis Agent').parameters);
  agent.options.systemMessage = readFileSync(new URL('code/competitive-analysis-prompt.txt',import.meta.url),'utf8');
  agent.text = '=Analyze this aggregated competitor data for the client and produce the exact JSON the schema requires.\n\ncomparison_metrics contains the reconciled values. owned_metrics covers the client profiles connected in Sprout; rival companies use RivalIQ and verified public LinkedIn posts. Public engagement excludes private clicks, saves, Instagram shares and YouTube shares. Audience and engagement rates in the cross-network benchmark exclude LinkedIn. Current audience snapshots carry audience_as_of and must never be described as historical growth. actual_impressions are client-only observations; estimated_impressions are RivalIQ estimates and may cover fewer profiles.\n\n{{ JSON.stringify($json) }}';
  operations.push({type:'updateNodeParameters',nodeName:'Competitive Analysis Agent',parameters:agent,replace:true});
  return operations;
}
