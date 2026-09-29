import {execFileSync} from 'node:child_process';
import {it,expect} from 'vitest';

it('publishes assets before the page and preserves the working release when a build fails',()=>{
  const result=execFileSync('bash',['scripts/qa-deploy.sh'],{encoding:'utf8'});
  expect(result).toContain('Deployment QA passed');
},15_000);
