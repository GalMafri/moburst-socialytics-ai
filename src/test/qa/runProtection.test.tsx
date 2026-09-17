import React from 'react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { render,screen,act,cleanup } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter,Routes,Route } from 'react-router-dom';
import RunAnalysis from '@/pages/RunAnalysis';
import CompetitiveRun from '@/pages/CompetitiveRun';
const f=vi.hoisted(()=>({status:'running',started:'',invokes:vi.fn(),readError:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({canRunAnalysis:true})}));
vi.mock('@/hooks/useRealtimeReport',()=>({useRealtimeReports:()=>{}}));
vi.mock('@/lib/telemetry',()=>({track:vi.fn()}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:()=>{}})}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:({children}:any)=><main>{children}</main>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:f.invokes},from:(table:string)=>{
 const filters:any={};let one=false;
 const q:any={select:()=>q,eq(k:string,v:any){filters[k]=v;return q},in:()=>q,order:()=>q,limit:()=>q,maybeSingle(){one=true;return q},then(resolve:any){
  const report={id:'existing',status:f.status,created_at:f.started,date_range_start:'2026-09-01',date_range_end:'2026-09-17'};
  let data:any=table==='clients'?{id:'client',name:'Fixture',social_keywords:['test']}:table==='competitor_sets'?{id:'set'}:table==='sprout_profiles'?[{id:'profile'}]:table==='competitors'?[]:one?((filters.status&&filters.status!==f.status)?null:report):[report];
  return Promise.resolve({data,error:f.readError&&filters.status==='running'?new Error('offline'):null}).then(resolve);
 }};return q;
}}}));
const clients:QueryClient[]=[];
function mount(kind:string){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/client']}><Routes><Route path='/:id' element={kind==='social'?<RunAnalysis/>:<CompetitiveRun/>}/></Routes></MemoryRouter></QueryClientProvider>);}
async function tick(ms=20){await act(async()=>{await vi.advanceTimersByTimeAsync(ms)});}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));f.started=new Date().toISOString();f.status='running';f.readError=false;f.invokes.mockClear();});
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
