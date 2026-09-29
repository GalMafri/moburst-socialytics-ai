// @vitest-environment node
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { summarizeLandscapes } from '../../../supabase/functions/_shared/competitive/rivaliqLandscape';
const script = readFileSync('n8n/code/competitive-resolve.js', 'utf8');
const companies = [{id:1,name:'Fixture',url:'https://fixture.agency'}, {id:2,name:'Fixture competitor',url:'https://rival.studio'}];
const selection = [{name:'Fixture competitor',website_url:'https://rival.studio',rivaliq_company_id:2}];
function resolve(landscapes: any[], competitors = selection, hint = '') {
  return runInNewContext('(function(){'+script+'})()', {
    $input: {first: () => ({json: {landscapes}})},
    $: (name: string) => ({first: () => ({json: name === 'Run Config'
      ? {client_name:'Fixture',landscape_hint:hint,competitors_json:JSON.stringify(competitors)}
      : {body:{website_url:'https://fixture.agency'}}})}),
  })[0].json;
}
it('app and workflow identify the exact website even when a competitor contains its name', () => {
  const landscape = {id:10,name:'Fixture',focusCompanyId:1,companies};
  expect(summarizeLandscapes([landscape], 'Fixture', 'https://fixture.agency')[0].client_company_id).toBe('1');
  expect(resolve([landscape]).client_company_id).toBe(1);
});
it('a landscape title cannot select a different client or modern TLD', () => {
  const wrong = {id:10,name:'Fixture',focusCompanyId:3,companies:[{id:3,name:'Fixture',url:'https://fixture.studio'},companies[1]]};
  const right = {id:11,name:'Tier 2',focusCompanyId:1,companies};
  expect(resolve([wrong,right]).landscape_id).toBe(11);
  expect(() => resolve([wrong])).toThrow('LANDSCAPE_NOT_FOUND');
});
it('a saved provider ID cannot override a different confirmed competitor website', () => {
  expect(() => resolve([{id:10,companies}], [{...selection[0],website_url:'https://other.studio'}], '10')).toThrow('TRACKING_SELECTION_MISMATCH');
});
it('a missing explicit landscape cannot silently fall back to an older selection', () => {
  expect(() => resolve([{id:10,companies}], selection, '99')).toThrow('LANDSCAPE_NOT_FOUND');
});
