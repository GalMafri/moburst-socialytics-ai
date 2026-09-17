import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

const readCode = name => readFileSync(new URL(`./code/${name}.js`, import.meta.url), 'utf8');
const expectedVersions = {
  social: '9bea04c7-81c8-40b7-8ecc-179847c5f5d5',
  competitive: '6f18e322-7268-4583-98b1-6de1fc242d7d',
};
const condition = value => ({ conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
  conditions: [{ id: 'qa-condition', leftValue: value, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and',
}, options: {} });

// Pure export transformation. No network, credentials, publishing or workflow execution.
export function applyQaPatches(input, kind) {
  if (!expectedVersions[kind]) throw new Error('Expected social or competitive');
  const workflow = structuredClone(input.workflow || input);
  if (workflow.versionId !== expectedVersions[kind]) throw new Error('Workflow changed since QA. Rebase and revalidate the patch before applying.');
  const get = name => {
    const matches = workflow.nodes.filter(node => node.name === name);
    if (matches.length !== 1) throw new Error(`Expected exactly one node named ${name}`);
    return matches[0];
  };
  const setCode = (name, file) => { get(name).parameters.jsCode = readCode(file); };
  const add = (name, type, typeVersion, parameters, position, extra = {}) => {
    if (workflow.nodes.some(n => n.name === name)) throw new Error(`Node already exists: ${name}`);
    workflow.nodes.push({ id: `qa-${name.toLowerCase().replace(/\W+/g, '-')}`, name, type, typeVersion, parameters, position, ...extra });
  };
  const connect = (source, targets) => {
    workflow.connections[source] = { ...workflow.connections[source], main: targets.map(names => names.map(name => ({ node: name, type: 'main', index: 0 }))) };
  };
  if (kind === 'competitive') {
    setCode('Aggregate Competitive Data', 'competitive-aggregate');
    const source = readFileSync(new URL('../supabase/functions/_shared/competitive/reportMetrics.ts', import.meta.url), 'utf8');
    const helpers = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText.replace(/^export /gm, '');
    get('Assemble Report Data').parameters.jsCode = helpers + '\n' + readCode('competitive-report');
  } else {
    setCode('Generate Run Summary', 'social-summary');
    setCode('Combine Brief Context with Client Data', 'combine-brief');
    get('Get Client Brief from Drive').parameters.fileId.value = "={{ $json.body?.brief_file_id || $json.brief_file_id || '' }}";
    get('Analyze Client Brief Context').parameters.text = '={{ $json.brief_text }}';
    add('Has Brief File', 'n8n-nodes-base.if', 2.2, condition('={{ !!($json.body?.brief_file_id || $json.brief_file_id) }}'), [-440, 160]);
    add('Brief Is PDF', 'n8n-nodes-base.if', 2.2, condition("={{ $binary.data?.mimeType === 'application/pdf' || $binary.data?.fileExtension === 'pdf' }}"), [-220, 160]);
    add('Extract Brief PDF', 'n8n-nodes-base.extractFromFile', 1, { operation: 'pdf', options: { joinPages: true, keepSource: 'both' } }, [0, 60], { onError: 'continueRegularOutput' });
    add('Prepare Brief Text', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: readCode('prepare-brief') }, [240, 160]);
    add('Has Brief Text', 'n8n-nodes-base.if', 2.2, condition('={{ !!$json.brief_text }}'), [460, 160]);
    connect('Workflow Configuration', [['Has Brief File']]);
    connect('Has Brief File', [['Get Client Brief from Drive'], ['Prepare Brief Text']]);
    connect('Get Client Brief from Drive', [['Brief Is PDF']]);
    connect('Brief Is PDF', [['Extract Brief PDF'], ['Prepare Brief Text']]);
    connect('Extract Brief PDF', [['Prepare Brief Text']]);
    connect('Prepare Brief Text', [['Has Brief Text']]);
    connect('Has Brief Text', [['Analyze Client Brief Context'], ['Combine Brief Context with Client Data']]);
    get('Wait').parameters = { resume: 'timeInterval', amount: 30, unit: 'seconds' };
    get('Fetch Gamma Result').parameters.url = "=https://public-api.gamma.app/v1.0/generations/{{ $('Create Gamma Presentation').first().json.id || $('Create Gamma Presentation').first().json.generationId || '' }}";
    get('Fetch Gamma Result').onError = 'continueRegularOutput';
    get('Create Gamma Presentation').onError = 'continueErrorOutput';
    // Generation creates a paid resource. A transport timeout is not proof it failed.
    get('Create Gamma Presentation').retryOnFail = false;
    add('Check Gamma State', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: readCode('check-gamma') }, [1300, 800]);
    add('Poll Gamma Again', 'n8n-nodes-base.if', 2.2, condition('={{ $json._gamma_poll_again === true }}'), [1520, 800]);
    connect('Create Gamma Presentation', [['Wait'], ['Generate Run Summary']]);
    connect('Fetch Gamma Result', [['Check Gamma State']]);
    connect('Check Gamma State', [['Poll Gamma Again']]);
    connect('Poll Gamma Again', [['Wait'], ['Generate Run Summary']]);
    const failureCallback = structuredClone(get('HTTP Request'));
    failureCallback.id = 'qa-mark-social-report-failed';
    failureCallback.name = 'Mark Social Report Failed';
    failureCallback.position = [1740, 1100];
    failureCallback.parameters.jsonBody = "={{ JSON.stringify({report_id: $('Webhook').first().json.body?.report_id || $('Webhook').first().json.report_id, status: 'failed', report_data: {error: 'The analysis workflow stopped before completion. Review the failed n8n execution before retrying.'}}) }}";
    workflow.nodes.push(failureCallback);
    add('Stop Failed Social Run', 'n8n-nodes-base.stopAndError', 1, { errorType: 'errorMessage', errorMessage: 'Social report failed. Its status was written back to the app.' }, [1960, 1100]);
    connect('Mark Social Report Failed', [['Stop Failed Social Run']]);
    for (const item of workflow.nodes) {
      const critical = !item.onError && ['n8n-nodes-base.code', 'n8n-nodes-base.set', 'n8n-nodes-base.httpRequest'].includes(item.type);
      if ((critical || item.name === 'AI Synthesis Agent') && !['HTTP Request', 'Mark Social Report Failed', 'Check Gamma State', 'Prepare Brief Text'].includes(item.name)) {
        item.onError = 'continueErrorOutput';
        const connections = workflow.connections[item.name] ||= {};
        connections.main ||= [];
        connections.main[0] ||= [];
        connections.main[1] = [{ node: 'Mark Social Report Failed', type: 'main', index: 0 }];
      }
    }
  }
  return workflow;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output)) throw new Error('Usage: node n8n/apply-qa-patches.mjs social|competitive INPUT.json OUTPUT.json (different paths)');
  const patched = applyQaPatches(JSON.parse(readFileSync(input, 'utf8')), kind);
  writeFileSync(output, JSON.stringify(patched, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(`Prepared ${kind} workflow with ${patched.nodes.length} nodes. Nothing was uploaded or published.`);
}
