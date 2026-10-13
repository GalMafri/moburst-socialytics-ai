import {afterEach,expect,it,vi} from 'vitest';
import {act,renderHook} from '@testing-library/react';
const state=vi.hoisted(()=>({status:'failed'}));
vi.mock('@tanstack/react-query',()=>({useQuery:(options:any)=>options}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 let status='';const query:any={select:()=>query,eq:(key:string,value:string)=>{if(key==='status')status=value;return query;},order:()=>query,limit:()=>query,maybeSingle:async()=>({data:status===state.status?{id:'run',status,created_at:new Date().toISOString()}:null})};return query;
}}}));
import {useActiveReportRun} from '@/hooks/useActiveReportRun';
import {WATCH_LIMIT_MINUTES} from '@/lib/runWatch';
const hook=(kind:'monthly'|'competitive')=>renderHook(()=>useActiveReportRun('client',kind)).result;
afterEach(()=>vi.useRealTimers());
it('does not reclassify a failed competitive attempt as running on navigation',async()=>{
 state.status='failed';expect(await (hook('competitive').current as any).queryFn()).toBeNull();
 expect((await (hook('monthly').current as any).queryFn()).status).toBe('failed');
});
it('continues to recover a genuinely running competitive attempt',async()=>{
 state.status='running';expect((await (hook('competitive').current as any).queryFn()).status).toBe('running');
});
it('stops polling at the watch limit and says it stopped',()=>{
 vi.useFakeTimers();
 const result=hook('competitive');const interval=(data:any)=>(result.current as any).refetchInterval({state:{data}});
 expect(interval(null)).toBe(8000);expect(result.current.watchStopped).toBe(false);
 // A run found past the limit is not polled either.
 expect(interval({status:'running',created_at:new Date(Date.now()-(WATCH_LIMIT_MINUTES+1)*60000).toISOString()})).toBe(false);
 act(()=>{vi.advanceTimersByTime(WATCH_LIMIT_MINUTES*60000);});
 expect(result.current.watchStopped).toBe(true);expect(interval(null)).toBe(false);
});
