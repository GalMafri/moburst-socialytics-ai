import React from 'react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { render,screen,act,cleanup,fireEvent } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter,Routes,Route } from 'react-router-dom';
import RunAnalysis from '@/pages/RunAnalysis';
import CompetitiveRun from '@/pages/CompetitiveRun';

// A person's report run (self-serve design, rule 7, 19 Oct 2026): asking
// queues a manual dispatch through run-report, the scheduled path makes the
// report and runs it again quietly, and the page shows the run from the
// request until the report exists. It never shows a failure or a retry.

type Request = { job_id: string; status: string; requested_at: string; range_start: string; range_end: string; report_id: string | null; open: boolean; runs: number; next_at: string };
const f=vi.hoisted(()=>({running:false,started:'',request:null as null | Request,invokes:vi.fn(),profiles:'ready',setsError:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({canRunAnalysis:true})}));
vi.mock('@/hooks/useRealtimeReport',()=>({useRealtimeReports:()=>{}}));
vi.mock('@/lib/telemetry',()=>({track:vi.fn()}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:({children}:any)=><main>{children}</main>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 functions:{invoke:f.invokes},
 rpc:async()=>({data:f.request?[f.request]:[],error:null}),
 from:(table:string)=>{
 const filters:any={};let one=false;
 const q:any={select:()=>q,eq(k:string,v:any){filters[k]=v;return q},gt:()=>q,in:()=>q,order:()=>q,limit:()=>q,maybeSingle(){one=true;return q},then(resolve:any){
  const report={id:'existing',status:'running',created_at:f.started,date_range_start:'2026-09-01',date_range_end:'2026-09-17'};
  let data:any=table==='clients'?{id:'client',name:'Fixture',social_keywords:['test']}
   :table==='competitor_sets'?[{id:'set',status:'confirmed',created_at:'2026-09-01',confirmed_at:'2026-09-01',confirmed_by:null,rivaliq_landscape_id:'612909',tracked_since:'2026-09-02T00:00:00Z'}]
   :table==='sprout_profiles'?[{id:'profile'}]
   :table==='competitors'?['One','Two','Three'].map((name,i)=>({id:String(i),name,selected_rank:i+1,competitor_handles:f.profiles==='missing'&&i===0?[]:[{is_active:true,source:f.profiles==='weak'&&i===0?'auto':'rivaliq',detection_confidence:0.4}]}))
   :one?(filters.status==='running'?(f.running?report:null):null):[];
  return Promise.resolve({data,error:(f.setsError&&table==='competitor_sets')?new Error('offline'):null}).then(resolve);
 }};return q;
}}}));
const clients:QueryClient[]=[];
function mount(kind:string){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/client']}><Routes><Route path='/:id' element={kind==='social'?<RunAnalysis/>:<CompetitiveRun/>}/></Routes></MemoryRouter></QueryClientProvider>);}
async function tick(ms=20){await act(async()=>{await vi.advanceTimersByTimeAsync(ms)});}
const request=(over:Partial<Request>={}):Request=>({job_id:'job',status:'queued',requested_at:new Date().toISOString(),range_start:'2026-09-01',range_end:'2026-09-17',report_id:null,open:true,runs:0,next_at:new Date().toISOString(),...over});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));f.started=new Date().toISOString();f.running=false;f.request=null;f.profiles='ready';f.setsError=false;f.invokes.mockReset();});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.useRealTimers();});

for(const kind of ['social','competitive']) describe(kind+' run screen',()=>{
 const noun=kind==='social'?'Analysis':'Competitive analysis';
 it('shows the run from the request until its report exists, and never a retry',async()=>{
  f.request=request();mount(kind);await tick();
  expect(screen.getByText(`Starting the ${noun.toLowerCase()}`)).toBeInTheDocument();
  f.running=true;f.request=request({report_id:'existing'});await tick(8000);
  expect(screen.getByText(`${noun} in progress`)).toBeInTheDocument();
  await tick(95*60000);
  expect(screen.queryByRole('button',{name:/run now|retry/i})).toBeNull();expect(screen.queryByText(/failed|did not finish|taking longer/i)).toBeNull();expect(f.invokes).not.toHaveBeenCalled();
 });
 it('resumes a running report after a refresh',async()=>{
  f.running=true;const first=mount(kind);await tick();await tick(16*60000);first.unmount();mount(kind);await tick();
  expect(screen.getByText('Elapsed: 16 minutes. This page updates when the report is ready.')).toBeInTheDocument();
 });
 it('says when a run that did not finish runs again on its own',async()=>{
  f.request=request({runs:1,next_at:new Date(Date.now()+30*60000).toISOString()});mount(kind);await tick();
  expect(screen.getByText(`${noun} runs again on its own`)).toBeInTheDocument();expect(screen.queryByText(/failed|error/i)).toBeNull();
 });
 it('says the run is complete once the report it watched exists',async()=>{
  f.request=request();mount(kind);await tick();
  f.request=request({status:'done',open:false,report_id:'made'});await tick(8000);
  expect(screen.getByText(kind==='social'?'Analysis complete. Opening the report.':'Analysis complete')).toBeInTheDocument();
 });
 it('asks quietly, and says only that it has not started when the request is not taken',async()=>{
  f.invokes.mockResolvedValue({data:null,error:{message:'Edge Function returned a non-2xx status code',context:{status:409}}});
  mount(kind);await tick();await tick();
  fireEvent.click(screen.getByRole('button',{name:kind==='social'?'Run full analysis':'Run competitive analysis'}));await tick();await tick();
  expect(screen.getByText('The analysis has not started yet.')).toBeInTheDocument();expect(screen.queryByRole('alert')).toBeNull();
 });
});

for (const state of ['missing','weak']) it(`runs a confirmed competitive selection whose profiles are ${state}: tracking reads RivalIQ by website`,async()=>{
 f.profiles=state;f.invokes.mockResolvedValue({data:{job_id:'job',queued:true},error:null});mount('competitive');await tick();await tick();
 const button=screen.getByRole('button',{name:'Run competitive analysis'});expect(button).toBeEnabled();
 expect(screen.queryByText(/needs a verified|no active social profiles|Review profiles/)).toBeNull();
 expect(screen.getByText(/Tracked since Sep 2, 2026/)).toBeInTheDocument();
});
it('distinguishes a failed selection request from having no confirmed selection',async()=>{
 f.setsError=true;mount('competitive');await tick();await tick();expect(screen.getByText('Could not load the competitor selection')).toBeInTheDocument();expect(f.invokes).not.toHaveBeenCalled();
});
it('asks for a ready competitive selection to run with the chosen period',async()=>{
 f.invokes.mockResolvedValue({data:{job_id:'job',queued:true},error:null});mount('competitive');await tick();await tick();const button=screen.getByRole('button',{name:'Run competitive analysis'});expect(button).toBeEnabled();fireEvent.click(button);await tick();expect(f.invokes).toHaveBeenCalledWith('run-report',expect.objectContaining({body:expect.objectContaining({kind:'competitive',client_id:'client',date_range_start:'2026-08-18',date_range_end:'2026-09-16'})}));
});

it('custom periods reject reversed/future dates and accept a single complete day',async()=>{
 mount('competitive');await tick();await tick();fireEvent.click(screen.getByRole('button',{name:'Custom'}));
 const start=screen.getByLabelText('Start'),end=screen.getByLabelText('End'),run=screen.getByRole('button',{name:'Run competitive analysis'});
 fireEvent.change(start,{target:{value:'2026-09-16'}});fireEvent.change(end,{target:{value:'2026-09-15'}});expect(run).toBeDisabled();
 fireEvent.change(end,{target:{value:'2026-09-18'}});expect(run).toBeDisabled();
 fireEvent.change(end,{target:{value:'2026-09-16'}});expect(run).toBeEnabled();expect(screen.getByText(/1 days of posts/)).toBeInTheDocument();expect(f.invokes).not.toHaveBeenCalled();
});
