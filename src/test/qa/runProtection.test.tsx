import React from 'react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { render,screen,act,cleanup,fireEvent } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter,Routes,Route } from 'react-router-dom';
import RunAnalysis from '@/pages/RunAnalysis';
import CompetitiveRun from '@/pages/CompetitiveRun';
const f=vi.hoisted(()=>({status:'running',started:'',invokes:vi.fn(),readError:false,profiles:'ready',setsError:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({canRunAnalysis:true})}));
vi.mock('@/hooks/useRealtimeReport',()=>({useRealtimeReports:()=>{}}));
vi.mock('@/lib/telemetry',()=>({track:vi.fn()}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:()=>{}})}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:({children}:any)=><main>{children}</main>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:f.invokes},from:(table:string)=>{
 const filters:any={};let one=false;
 const q:any={select:()=>q,eq(k:string,v:any){filters[k]=v;return q},in:()=>q,order:()=>q,limit:()=>q,maybeSingle(){one=true;return q},then(resolve:any){
  const report={id:'existing',status:f.status,created_at:f.started,date_range_start:'2026-09-01',date_range_end:'2026-09-17'};
   // competitor_sets is read as a list now: the run page has to be able to see
   // a newer unconfirmed draft behind the confirmed set it would actually use.
   let data:any=table==='clients'?{id:'client',name:'Fixture',social_keywords:['test']}:table==='competitor_sets'?[{id:'set',status:'confirmed',created_at:'2026-09-01',confirmed_at:'2026-09-01',rivaliq_landscape_id:'612909'}]:table==='sprout_profiles'?[{id:'profile'}]:table==='competitors'?['One','Two','Three'].map((name,i)=>({id:String(i),name,selected_rank:i+1,competitor_handles:f.profiles==='missing'&&i===0?[]:[{is_active:true,source:f.profiles==='weak'&&i===0?'auto':'rivaliq',detection_confidence:0.4}]})):one?((filters.status&&filters.status!==f.status)?null:report):[report];

  return Promise.resolve({data,error:(f.readError&&filters.status==='running'||f.profiles==='error'&&table==='competitors'||f.setsError&&table==='competitor_sets')?new Error('offline'):null}).then(resolve);
 }};return q;
}}}));
const clients:QueryClient[]=[];
function mount(kind:string){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/client']}><Routes><Route path='/:id' element={kind==='social'?<RunAnalysis/>:<CompetitiveRun/>}/></Routes></MemoryRouter></QueryClientProvider>);}
async function tick(ms=20){await act(async()=>{await vi.advanceTimersByTimeAsync(ms)});}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));f.started=new Date().toISOString();f.status='running';f.readError=false;f.profiles='ready';f.setsError=false;f.invokes.mockClear();});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();});
for(const kind of ['social','competitive']) describe(kind+' running screen',()=>{
 it('resumes after refresh, survives old timeout, and requires review after 90 minutes',async()=>{
  const first=mount(kind);await tick();expect(screen.getByText('Analysis in progress')).toBeInTheDocument();
  await tick(16*60000);expect(screen.queryByText('Analysis issue')).toBeNull();expect(screen.queryByRole('button',{name:/retry/i})).toBeNull();
  first.unmount();mount(kind);await tick();expect(screen.getByText('Elapsed: 16 minutes. This page updates when the report is ready.')).toBeInTheDocument();
  await tick(74*60000);expect(screen.getByRole('button',{name:'Review retry'})).toBeInTheDocument();expect(f.invokes).not.toHaveBeenCalled();
 });
 it('does not enable start when the active run check fails',async()=>{
  f.readError=true;f.status='complete';mount(kind);await tick();expect(screen.getByRole('button',{name:kind==='social'?'Run Full Analysis':'Run competitive analysis'})).toBeDisabled();
 });
 it('continues detecting completion beyond the former timeout',async()=>{
  mount(kind);await tick();await tick(16*60000);f.status=kind==='social'?'completed':'complete';await tick(8000);expect(screen.getByText(kind==='social'?'Analysis complete! Redirecting...':'Analysis complete')).toBeInTheDocument();
 });
});

for (const state of ['missing','weak','error']) it(`blocks competitive submission when profiles are ${state}`,async()=>{
 f.status='complete';f.profiles=state;mount('competitive');await tick();await tick();
 const button=screen.getByRole('button',{name:'Run competitive analysis'});expect(button).toBeDisabled();fireEvent.click(button);expect(f.invokes).not.toHaveBeenCalled();
 expect(screen.getByText(state==='error'?'Could not check competitor profiles':state==='missing'?'One has no active social profiles.':'One needs a verified social profile.')).toBeInTheDocument();
});
it('distinguishes a failed selection request from having no confirmed selection',async()=>{
 f.status='complete';f.setsError=true;mount('competitive');await tick();await tick();expect(screen.getByText('Could not load the competitor selection')).toBeInTheDocument();expect(screen.queryByText(/No confirmed competitor set/)).toBeNull();expect(f.invokes).not.toHaveBeenCalled();
});
it('allows a ready competitive selection to run with the chosen period',async()=>{
 f.status='complete';f.invokes.mockResolvedValue({data:{report_id:'new',created_at:f.started},error:null});mount('competitive');await tick();await tick();const button=screen.getByRole('button',{name:'Run competitive analysis'});expect(button).toBeEnabled();fireEvent.click(button);await tick();expect(f.invokes).toHaveBeenCalledWith('run-report',expect.objectContaining({body:expect.objectContaining({kind:'competitive',client_id:'client',date_range_start:'2026-08-18',date_range_end:'2026-09-16'})}));
});
