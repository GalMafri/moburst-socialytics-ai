import {expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({status:'failed'}));
vi.mock('@tanstack/react-query',()=>({useQuery:(options:any)=>options}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 let status='';const query:any={select:()=>query,eq:(key:string,value:string)=>{if(key==='status')status=value;return query;},order:()=>query,limit:()=>query,maybeSingle:async()=>({data:status===state.status?{id:'run',status,created_at:new Date().toISOString()}:null})};return query;
}}}));
import {useActiveReportRun} from '@/hooks/useActiveReportRun';
it('does not reclassify a failed competitive attempt as running on navigation',async()=>{
 state.status='failed';expect(await (useActiveReportRun('client','competitive') as any).queryFn()).toBeNull();
 expect((await (useActiveReportRun('client','monthly') as any).queryFn()).status).toBe('failed');
});
it('continues to recover a genuinely running competitive attempt',async()=>{
 state.status='running';expect((await (useActiveReportRun('client','competitive') as any).queryFn()).status).toBe('running');
});
