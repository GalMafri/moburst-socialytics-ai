/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles model heterogeneous response shapes. */
import React from 'react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { render,screen,cleanup,within } from '@testing-library/react';
import { MemoryRouter,Routes,Route } from 'react-router-dom';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import AllReports from '@/pages/AllReports';
import ReportHistory from '@/pages/ReportHistory';
import { lastCompleteMonth,listedMonthlyReports } from '@/lib/reportRun';

// The report lists (All reports, a client's history): one ready report per
// client and period, only the columns they read, one presentation button.

const f=vi.hoisted(()=>({reports:[] as any[],selects:[] as Array<{table:string;columns:string}>,reads:[] as string[]}));
vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({isLoading:false,isAuthenticated:true,isMoburstStaff:true,isClient:false,isAdmin:false,canDelete:false,canRunAnalysis:true,user:{_id:'staff'}})}));
vi.mock('@/hooks/useRealtimeReport',()=>({useRealtimeReports:()=>{}}));
vi.mock('@/lib/telemetry',()=>({track:vi.fn()}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:({children}:any)=><main>{children}</main>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  rpc:async()=>({data:[],error:null}),
  from:(table:string)=>{
    let range:[number,number]|null=null;
    const q:any={select(columns:string){f.selects.push({table,columns});return q},is(){return q},eq(){return q},neq(){return q},order(){return q},limit(){return q},in(){return q},
      range(a:number,b:number){range=[a,b];return q},
      maybeSingle:async()=>{f.reads.push(table);return{data:table==='clients'?{id:'c1',name:'Moburst'}:null,error:null}},
      then:(resolve:any,reject:any)=>{f.reads.push(table);const rows=table==='reports'?(range?f.reports.slice(range[0],range[1]+1):f.reports):table==='clients'?[{id:'c1',name:'Moburst'}]:[];return Promise.resolve({data:rows,error:null}).then(resolve,reject)}};
    return q;
  }}}));

const report=(id:string,over:any={})=>({id,client_id:'c1',status:'completed',created_at:'2026-11-03T08:00:00Z',date_range_start:'2026-10-01',date_range_end:'2026-10-31',duration_minutes:7,gamma_url:null,clients:{id:'c1',name:'Moburst'},...over});
const clients:QueryClient[]=[];
function mount(node:React.ReactNode,path='/'){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{f.reports=[];f.selects=[];f.reads=[];});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());});

const octoberThree=()=>[
  report('newest',{created_at:'2026-11-05T08:00:00Z'}),
  report('rerun',{created_at:'2026-11-04T08:00:00Z'}),
  report('first',{created_at:'2026-11-03T08:00:00Z'}),
  report('september',{created_at:'2026-10-03T08:00:00Z',date_range_start:'2026-09-01',date_range_end:'2026-09-30'}),
];

describe('one ready report per client and period',()=>{
  it('keeps the newest ready report of a period and every other period',()=>{
    const rows=listedMonthlyReports(octoberThree(),{isStaff:true});
    expect(rows.map(r=>r.id)).toEqual(['newest','september']);
  });
  it('keeps a report that is running beside the ready one, and another client\'s same period',()=>{
    const rows=listedMonthlyReports([report('running',{status:'running',created_at:'2026-11-06T08:00:00Z'}),report('ready'),report('other',{client_id:'c2'})],{isStaff:true});
    expect(rows.map(r=>r.id)).toEqual(['running','ready','other']);
  });
  it('lists the three October reports of All reports as one row',async()=>{
    f.reports=octoberThree();mount(<AllReports/>);
    expect(await screen.findAllByRole('row')).toHaveLength(3);
    expect(screen.getAllByText('Oct 1, 2026 to Oct 31, 2026')).toHaveLength(1);
  });
  it('lists them as one row in the client\'s history',async()=>{
    f.reports=octoberThree();
    mount(<Routes><Route path='/clients/:id/reports' element={<ReportHistory/>}/></Routes>,'/clients/c1/reports');
    expect(await screen.findAllByRole('row')).toHaveLength(3);
  });
  it('pages by the reports it shows, so a period never reappears on the next page',async()=>{
    // 60 reruns of one period, then one older period: the second one is on the first page.
    f.reports=[...Array.from({length:60},(_,i)=>report('r'+i,{created_at:new Date(Date.UTC(2026,10,5,8,60-i)).toISOString()})),report('old',{created_at:'2026-10-03T08:00:00Z',date_range_start:'2026-09-01',date_range_end:'2026-09-30'})];
    mount(<AllReports/>);
    expect(await screen.findAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('button',{name:'Next monthly reports'})).toBeNull();
  });
});

describe('a report stored without range columns',()=>{
  const old=(id:string,start:string,end:string,over:any={})=>report(id,{date_range_start:null,date_range_end:null,report_period:{current_month:{start,end}},...over});
  it('is keyed by the period inside its data: different periods are different rows',()=>{
    const rows=listedMonthlyReports([old('a','2026-02-01','2026-02-11'),old('b','2026-03-01','2026-03-04')],{isStaff:true});
    expect(rows.map(r=>r.id)).toEqual(['a','b']);
  });
  it('is one row when the stored period is the same',()=>{
    const rows=listedMonthlyReports([old('new','2026-03-01','2026-03-11',{created_at:'2026-11-05T08:00:00Z'}),old('old','2026-03-01','2026-03-11')],{isStaff:true});
    expect(rows.map(r=>r.id)).toEqual(['new']);
  });
  it('reads the period from report_data too, and never merges a report whose period is unknown',()=>{
    const nested=report('n',{date_range_start:null,date_range_end:null,report_data:{report_period:{current_month:{start:'2026-02-01',end:'2026-02-11'}}}});
    const unknown=(id:string)=>report(id,{date_range_start:null,date_range_end:null});
    expect(listedMonthlyReports([nested,old('o','2026-03-01','2026-03-11')],{isStaff:true}).map(r=>r.id)).toEqual(['n','o']);
    expect(listedMonthlyReports([unknown('u1'),unknown('u2')],{isStaff:true}).map(r=>r.id)).toEqual(['u1','u2']);
  });
  it('asks the lists for that sub-path, not the whole report',async()=>{
    f.reports=[old('a','2026-02-01','2026-02-11'),old('b','2026-03-01','2026-03-04')];
    mount(<AllReports/>);
    expect(await screen.findAllByRole('row')).toHaveLength(3);
    expect(f.selects.filter(s=>s.table==='reports').every(s=>s.columns.includes('report_data->report_period'))).toBe(true);
  });
});

describe('the list queries',()=>{
  it('ask only for the columns the lists read, never the whole report',async()=>{
    f.reports=[report('a')];
    mount(<AllReports/>);await screen.findAllByRole('row');
    mount(<Routes><Route path='/clients/:id/reports' element={<ReportHistory/>}/></Routes>,'/clients/c1/reports');
    await screen.findAllByText('Ready');
    const asked=f.selects.filter(s=>s.table==='reports').map(s=>s.columns);
    expect(asked.length).toBeGreaterThanOrEqual(2);
    for(const columns of asked){expect(columns.replace('report_period:report_data->report_period','')).not.toMatch(/\*|report_data/);}
  });
  it('make no request to client_users: the route already limits All reports to staff',async()=>{
    f.reports=[report('a')];mount(<AllReports/>);await screen.findAllByRole('row');
    expect(f.reads).not.toContain('client_users');
  });
});

describe('the presentation link',()=>{
  const link=(url:string)=>report('p',{gamma_url:url});
  it('is the same "Open presentation" link on every list, opened without opener access',async()=>{
    f.reports=[link('https://example.com/deck')];
    const all=mount(<AllReports/>);
    const a=await screen.findByRole('link',{name:'Open presentation'});
    expect(a).toHaveAttribute('href','https://example.com/deck');expect(a).toHaveAttribute('target','_blank');expect(a.getAttribute('rel')).toMatch(/noopener/);
    all.unmount();
    mount(<Routes><Route path='/clients/:id/reports' element={<ReportHistory/>}/></Routes>,'/clients/c1/reports');
    const b=await screen.findByRole('link',{name:'Open presentation'});
    expect(b.getAttribute('rel')).toMatch(/noopener/);
    expect(within(b.closest('tr')!).queryByText('Open',{exact:true})).toBeNull();
  });
});

describe('the last complete month',()=>{
  it.each([['2026-11-12','2026-10-01','2026-10-31'],['2026-03-02','2026-02-01','2026-02-28'],['2026-01-15','2025-12-01','2025-12-31'],['2028-03-01','2028-02-01','2028-02-29']])('on %s is %s to %s',(today,start,end)=>{
    expect(lastCompleteMonth(today)).toEqual({start,end});
  });
});
