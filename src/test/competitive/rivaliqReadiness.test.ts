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
