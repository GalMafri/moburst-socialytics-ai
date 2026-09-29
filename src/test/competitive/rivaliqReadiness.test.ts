import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync('n8n/code/check-rivaliq-readiness.js', 'utf8');
const run = (status: unknown, runIndex = 0) => vm.runInNewContext('(function(){' + source + '})()', {
 $input: { first: () => ({ json: { status } }) }, $runIndex: runIndex,
})[0].json;
it('waits for pending updates and proceeds only when RivalIQ says ready', () => {
 expect(run(2)).toEqual({status:2,ready:false,checks:1});
 expect(run(1,4)).toEqual({status:1,ready:true,checks:5});
});
it('bounds collection waits and rejects unrecognised responses', () => {
 expect(() => run(2,30)).toThrow(/still collecting/);
 expect(run(1,30).ready).toBe(true);
 for(const status of [null,undefined,0,3,'1']) expect(() => run(status)).toThrow(/valid data-readiness/);
});

it('keeps the original landscape identity through a pending-to-ready polling loop', () => {
 const patch = JSON.parse(readFileSync('n8n/competitive-readiness-patch.json', 'utf8'));
 const url = patch.operations.find((op: any) => op.nodeName === 'Landscape Status' && op.parameters?.url).parameters.url;
 const expression = url.match(/{{(.*?)}}/)[1];
 for (const status of [2, 2, 1]) {
  const output = run(status);
  const landscape = vm.runInNewContext(expression, { $json: output, $: () => ({ first: () => ({ json: { landscape_id: 654460 } }) }) });
  expect(url.replace(/{{.*?}}/, landscape)).toBe('=https://api.rivaliq.com/v3/landscapes/654460/status');
 }
});
