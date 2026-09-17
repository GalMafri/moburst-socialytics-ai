/* eslint-disable @typescript-eslint/no-explicit-any -- Partial provider/query doubles intentionally model heterogeneous response shapes. */
import React from 'react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { MemoryRouter,Routes,Route } from 'react-router-dom';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { CopyEditor } from '@/components/reports/calendar/CopyEditor';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { SchedulePostModal } from '@/components/reports/SchedulePostModal';
import { StaffOnlyRoute } from '@/components/StaffOnlyRoute';
import { ClientDashboard } from '@/components/dashboard/ClientDashboard';
import ReportHistory from '@/pages/ReportHistory';
import AllReports from '@/pages/AllReports';
import { ContentIdeasTab } from '@/components/reports/calendar/ContentIdeasTab';
import { applyCopyRevisions } from '@/lib/calendarRevision';
import { FunnelCard } from '@/components/usage/UsageSections';

const f=vi.hoisted(()=>({role:'staff',insertError:null as any,assignedError:null as any,iterationsError:null as any,reportRows:null as any[] | null,rows:[] as any[],reads:[] as string[],invokes:[] as any[],success:vi.fn(),error:vi.fn(),warning:vi.fn()}));
vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
vi.stubGlobal('fetch',vi.fn(()=>Promise.reject(new Error('Unexpected outbound request'))));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({isLoading:false,isAuthenticated:true,isMoburstStaff:f.role==='staff',isClient:f.role==='client',isAdmin:false,isGosSession:true,canRunAnalysis:f.role==='staff',canDelete:false,user:{_id:'fixture-user',name:'Fixture user',company:null}})}));
vi.mock('@/lib/telemetry',()=>({track:vi.fn(),editDistancePct:()=>25}));
vi.mock('sonner',()=>({toast:{success:f.success,error:f.error,warning:f.warning}}));
vi.mock('@/hooks/useRealtimePostIterations',()=>({useRealtimePostIterations:()=>{}}));
vi.mock('@/hooks/useRealtimeReport',()=>({useRealtimeReports:()=>{}}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:({children,title}:any)=><main><h1>{title}</h1>{children}</main>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  auth:{getUser:async()=>({data:{user:{id:'fixture-user'}}})},
  functions:{invoke:async(name:string,args:any)=>{
    f.invokes.push({name,args});
    if(name==='sprout-profiles')return{data:{profiles:[{id:1,name:'Fixture brand',network_type:'linkedin_company'}]},error:null};
    if(name==='regenerate-post-copy')return{data:{post:{copy:'Regenerated fixture copy'}},error:null};
    if(name==='schedule-sprout-post')return{data:{success:true,recorded:true},error:null};
    return{data:{},error:null};
  }},
  from:(table:string)=>{
    let range: [number,number] | null = null;
    const q:any={select(){return q},is(){return q},range(start:number,end:number){range=[start,end];return q},eq(){return q},neq(){return q},order(){return q},limit(){return q},in(){return q},
      insert:async(row:any)=>{if(!f.insertError)f.rows.push({...row});return{data:null,error:f.insertError}},
      maybeSingle:async()=>{f.reads.push(table);return{data:table==='clients'?{id:'fixture-client',name:'Fixture company',hub_company_name:'Legacy name',media_backend:'higgsfield'}:fixtureReport(),error:null}},
      then:(resolve:any,reject:any)=>{f.reads.push(table);const value=table==='client_users'?[]:table==='clients'?[{id:'fixture-client',name:'Fixture company',hub_company_name:'Legacy name'}]:table==='reports'?(range?(f.reportRows||[fixtureReport()]).slice(range[0],range[1]+1):f.reportRows||[fixtureReport()]):table==='sprout_profiles'?[{sprout_profile_id:1,network_type:'linkedin_company'}]:[...f.rows];return Promise.resolve({data:value,error:table==='sprout_profiles'?f.assignedError:table==='post_iterations'?f.iterationsError:null}).then(resolve,reject)}
    };return q;
  }
}}));

function fixtureReport(){return{id:'fixture-report',client_id:'fixture-client',status:'completed',created_at:'2026-09-16T08:00:00Z',date_range_start:'2026-09-01',date_range_end:'2026-09-15',duration_minutes:7,report_data:{},gamma_url:null};}
const original={_calendarPostKey:'fixture-post-key',_originalCopy:'Original fixture copy',copy:'Original fixture copy',platform:'LinkedIn',format:'Single Image',visual_direction:'A simple blue illustration',posting_time:'3:00 PM UTC'};
const panels=()=> <PostPanel open onOpenChange={()=>{}} post={original} postIterations={[]} clientId="fixture-client" reportId="fixture-report" clientTimezone="UTC"/>;
const clients:QueryClient[]=[];
function mount(node:React.ReactNode,path='/'){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});clients.push(client);
 return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>);
}
beforeEach(()=>{f.role='staff';f.iterationsError=null;f.reportRows=null;f.insertError=null;f.assignedError=null;f.rows=[];f.reads=[];f.invokes=[];f.success.mockClear();f.error.mockClear();f.warning.mockClear();});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());});
async function edit(text='Reviewed fixture copy',success=true){
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 fireEvent.change(screen.getByPlaceholderText('Edit post copy...'),{target:{value:text}});
 fireEvent.click(screen.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(success ? f.success : f.error).toHaveBeenCalled());
}

describe('QA-02 actual copy and scheduling components',()=>{
 it('control: successful edit persists a linked revision and updates visible text',async()=>{
  mount(<CopyEditor post={original} clientId="fixture-client" reportId="fixture-report"/>);await edit();
  expect(screen.getByText('Reviewed fixture copy')).toBeInTheDocument();expect(f.rows.map(x=>x.post_copy)).toEqual(['Reviewed fixture copy']);
 });
 it('shows failure and never success when persistence returns an error',async()=>{
  f.insertError={message:'fixture write rejected'};mount(<CopyEditor post={original} clientId="fixture-client" reportId="fixture-report"/>);await edit('Reviewed fixture copy',false);
  expect(f.rows).toHaveLength(0);expect(f.success).not.toHaveBeenCalled();expect(f.error).toHaveBeenCalledWith(expect.stringContaining('fixture write rejected'));
 });
 it('restores the persisted revision after remount',async()=>{
  const first=mount(<CopyEditor post={original} clientId="fixture-client" reportId="fixture-report"/>);await edit();first.unmount();mount(<CopyEditor post={applyCopyRevisions(original,f.rows)} clientId="fixture-client"/>);
  expect(f.rows.at(-1).post_copy).toBe('Reviewed fixture copy');expect(screen.getByText('Reviewed fixture copy')).toBeInTheDocument();expect(screen.queryByText('Original fixture copy')).toBeNull();
 });
 it('uses the edited copy in the actual scheduler',async()=>{
  mount(panels());await edit();fireEvent.click(screen.getByRole('tab',{name:'Schedule'}));fireEvent.click(screen.getByRole('button',{name:'Open scheduler'}));
  await waitFor(()=>expect(screen.getByLabelText('Post copy (includes hashtags)')).toHaveValue('Reviewed fixture copy'));
  expect(f.rows.at(-1).post_copy).toBe('Reviewed fixture copy');
 });
 it('uses regenerated copy in the actual scheduler',async()=>{
  mount(panels());fireEvent.click(screen.getByRole('button',{name:'Regenerate'}));await waitFor(()=>expect(screen.getByText('Regenerated fixture copy')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('tab',{name:'Schedule'}));fireEvent.click(screen.getByRole('button',{name:'Open scheduler'}));expect(screen.getByLabelText('Post copy (includes hashtags)')).toHaveValue('Regenerated fixture copy');
 });
});

describe('QA-03 counterexamples through actual permitted client routes',()=>{
 it('control: client is redirected away from the staff-only global report route',async()=>{
  f.role='client';mount(<Routes><Route path="/reports" element={<StaffOnlyRoute><div>Global report list</div></StaffOnlyRoute>}/><Route path="/" element={<div>Client dashboard destination</div>}/></Routes>,'/reports');
  expect(await screen.findByText('Client dashboard destination')).toBeInTheDocument();expect(screen.queryByText('Global report list')).toBeNull();
 });
 it('control: staff can render the staff-only global route',()=>{
  mount(<StaffOnlyRoute><div>Global report list</div></StaffOnlyRoute>);expect(screen.getByText('Global report list')).toBeInTheDocument();
 });
 it('control: gOS client dashboard loads its RLS-visible company without client_users',async()=>{
  f.role='client';mount(<ClientDashboard/>);expect(await screen.findByRole('button',{name:'Open the latest report'})).toBeInTheDocument();expect(f.reads).not.toContain('client_users');
 });
 it('control: actual client history displays its report without client_users',async()=>{
  f.role='client';mount(<Routes><Route path="/clients/:id/reports" element={<ReportHistory/>}/></Routes>,'/clients/fixture-client/reports');
  expect(await screen.findByText('completed')).toBeInTheDocument();expect(screen.getByRole('button',{name:'View'})).toBeInTheDocument();expect(f.reads).not.toContain('client_users');
 });
});

describe('QA-06 actual schedule form',()=>{
 it('submits the client timezone independently of the browser zone',async()=>{
  mount(<SchedulePostModal open onOpenChange={()=>{}} post={original} clientId="fixture-client" reportId="fixture-report" clientTimezone="UTC" generatedMediaUrls={[]}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Schedule Post'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Date'),{target:{value:'2030-09-21'}});fireEvent.change(screen.getByLabelText('Time (UTC)'),{target:{value:'15:00'}});fireEvent.click(screen.getByRole('button',{name:'Schedule Post'}));
  await waitFor(()=>expect(f.invokes.some(x=>x.name==='schedule-sprout-post')).toBe(true));
  expect(f.invokes.find(x=>x.name==='schedule-sprout-post').args.body.scheduled_time).toBe('2030-09-21T15:00:00.000Z');
 });
 it('control: failed assigned-profile read prevents scheduling',async()=>{
  f.assignedError={message:'fixture read rejected'};
  mount(<SchedulePostModal open onOpenChange={()=>{}} post={original} clientId="fixture-client" reportId="fixture-report" generatedMediaUrls={[]}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent("assigned profiles could not be loaded");expect(screen.getByRole('button',{name:'Schedule Post'})).toBeDisabled();
 });
});

describe('QA-13 and QA-15 actual UI branches',()=>{
 it('client cannot see staff-only copy generation or scheduling',()=>{
  f.role='client';mount(panels());expect(screen.queryByRole('button',{name:'Regenerate'})).toBeNull();expect(screen.queryByRole('tab',{name:'Schedule'})).toBeNull();
 });
 it('shows independent activity counts without invented conversion',()=>{
  mount(<FunnelCard rows={[{step:'Analysis finished',step_order:1,users:1,events:1},{step:'Opened the report',step_order:2,users:5,events:5}]}/>);
  expect(screen.queryByText('500%')).toBeNull();expect(screen.getByText('People by activity')).toBeInTheDocument();expect(screen.getByText('5 people')).toBeInTheDocument();
 });
});

const calendar = () => <ContentIdeasTab contentCalendar={[{day:'Monday',date_label:'2030-09-23',posts:[{copy:'Original fixture copy',platform:'LinkedIn',format:'Single Image'}]}]} aiAnalysis={{}} sproutPerformance={{}} clientId="fixture-client" reportId="fixture-report" availablePlatforms={['LinkedIn']} availableLanguages={['en']} clientTimezone="UTC"/>;
describe('whole calendar persistence and history paging',()=>{
 it('loads saved copy after editing, closing and remounting the calendar',async()=>{
  const first=mount(calendar());
  fireEvent.click(await screen.findByRole('button',{name:'Open post: Original fixture copy'}));
  await edit('Whole calendar edited copy');
  first.unmount();
  mount(calendar());
  fireEvent.click(await screen.findByRole('button',{name:'Open post: Whole calendar edited copy'}));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Whole calendar edited copy');
 });
 it('prevents editing original copy when saved revisions cannot load',async()=>{
  f.iterationsError={message:'Fixture revision read rejected'};
  mount(calendar());
  expect(await screen.findByRole('alert')).toHaveTextContent('Saved post changes could not be loaded');
  expect(screen.queryByRole('button',{name:'Open post: Original fixture copy'})).not.toBeInTheDocument();
 });
 it('opens the second page and returns to the first with 51 reports',async()=>{
  f.reportRows=Array.from({length:51},(_,i)=>({...fixtureReport(),id:'report-'+i,clients:{id:'client-'+i,name:'Brand '+String(i+1).padStart(3,'0')}}));
  mount(<AllReports/>);
  expect(await screen.findByText('Brand 050')).toBeInTheDocument();
  expect(screen.queryByText('Brand 051')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Next monthly reports'}));
  expect(await screen.findByText('Brand 051')).toBeInTheDocument();
  expect(screen.queryByText('Brand 001')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Previous monthly reports'}));
  expect(await screen.findByText('Brand 001')).toBeInTheDocument();
 });
});
