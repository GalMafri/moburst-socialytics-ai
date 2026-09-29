import { expect, it } from 'vitest';
import { missingProfileRepairs } from '../../../supabase/functions/_shared/competitive/profileRepairs';
import { competitiveBrief } from '../../../supabase/functions/_shared/competitive/brief';

const handle = (platform: string, value: string, overrides = {}) => ({ platform, handle: value, source: 'auto', detection_confidence: 0.95, is_active: true, ...overrides });
const selected = (handles = [handle('youtube', 'MedisafeTeam')]) => [{ name: 'Medisafe', website_url: 'https://medisafe.com/', handles }];
const tracked = [{ id: 2009405, url: 'https://www.medisafe.com/', facebook: { handle: 'MedisafeProject' } }];

it('carries reviewed profiles missing from website discovery into a verified company', () => {
 expect(missingProfileRepairs(selected(), tracked)).toEqual([{ companyId:2009405,name:'Medisafe',patch:{youTube:{handle:'MedisafeTeam'}} }]);
});
it('does not overwrite an existing presence or repeat a confirmed repair', () => {
 expect(missingProfileRepairs(selected(), [{...tracked[0], youTube:{nativeId:'UC0123456789012345678901'}}])).toEqual([]);
 expect(missingProfileRepairs(selected([handle('facebook','OtherHandle')]), tracked)).toEqual([]);
});
it('ignores unreviewed, inactive and unsupported presences', () => {
 expect(missingProfileRepairs(selected([
  handle('youtube','Uncertain',{detection_confidence:0.4}), handle('instagram','Inactive',{is_active:false}),
  handle('x','Rejected',{source:'rejected'}), handle('linkedin','medisafe'), handle('tiktok','medisafe'),
 ]),tracked)).toEqual([]);
});
it('uses native IDs when required and maps X to the provider field', () => {
 const repairs=missingProfileRepairs(selected([handle('youtube','UC0123456789012345678901'),handle('x','medisafeapp'),handle('facebook','111249148927499')]),[{id:1,url:'https://medisafe.com'}]);
 expect(repairs[0].patch).toEqual({youTube:{nativeId:'UC0123456789012345678901'},twitter:{handle:'medisafeapp'},facebook:{nativeId:'111249148927499'}});
});
it('refuses ambiguous identity and multiple primary profile choices', () => {
 expect(()=>missingProfileRepairs(selected(),[...tracked,...tracked])).toThrow('not uniquely tracked');
 expect(()=>missingProfileRepairs(selected(),[{id:1,url:'https://other.com'}])).toThrow('not uniquely tracked');
 expect(()=>missingProfileRepairs(selected([handle('youtube','One'),handle('youtube','Two')]),tracked)).toThrow('multiple reviewed');
});
function briefDb(report_data: any) {
 const reads:string[]=[];
 return { reads, from(table:string) {
  reads.push(table);
  const result=table==='competitive_reports' ? {created_at:'2026-09-29',report_data} : [];
  const query:any={select:()=>query,eq:()=>query,order:()=>query,limit:()=>query,maybeSingle:()=>query,then:(resolve:any)=>Promise.resolve({data:result}).then(resolve)};
  return query;
 }};
}
it('does not pass a held report into creative generation', async () => {
 const db=briefDb({quality_check:{state:'needs_review',reasons:['Wrong period']},ai_analysis:{executive_summary:'Do not use'}});
 expect(await competitiveBrief(db,'client')).toBe('');
 expect(db.reads).toEqual(['competitive_reports']);
});
it('removes unsupported competitor claims before building creative context', async () => {
 const db=briefDb({aggregates:{companies:[{name:'Client',is_client:true,post_count:10},{name:'Empty rival',post_count:0}]},ai_analysis:{winner_teardown:[{competitor:'Empty rival',pattern:'Invented pattern'}],executive_summary:'Supported summary'}});
 const result=await competitiveBrief(db,'client');
 expect(result).toContain('Supported summary');expect(result).not.toContain('Invented pattern');
});
