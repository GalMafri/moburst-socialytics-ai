import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CompetitiveIndex from '@/pages/CompetitiveIndex';
import { AdminDashboard } from '@/components/dashboard/AdminDashboard';
const state = vi.hoisted(() => ({ canRun: true }));
const clients = [
 {id:'alpha',name:'Alpha',reports:[],platforms:[],archived_at:null},
 {id:'beta',name:'Beta',reports:[],platforms:[],archived_at:null},
 {id:'archived',name:'Archived',reports:[],platforms:[],archived_at:'2026-01-01'},
];
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({canManageClients:true,canRunAnalysis:state.canRun,canDelete:true})}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:({children}:any)=><main>{children}</main>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{channel:()=>({on:()=>({subscribe:()=>({})})}),removeChannel:vi.fn()}}));
vi.mock('@tanstack/react-query',async importOriginal=>({...(await importOriginal<any>()),useQuery:({queryKey}:any)=>({data:queryKey[0]==='clients'?clients:clients.slice(0,2).map(c=>({...c,runnable:{id:c.id},tracking:{ready:true,headline:'Connected'},selection:{headline:'Three selected'},outcome:{headline:'Ready'}})),isLoading:false})}));
function Location(){return <output data-testid="location">{useLocation().pathname}{useLocation().search}</output>}
function mount(Page:any,path='/') {return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><Page/><Location/></MemoryRouter></QueryClientProvider>)}
afterEach(()=>{cleanup();state.canRun=true});
for(const [name,Page] of [['competitive',CompetitiveIndex],['dashboard',AdminDashboard]] as const){
 it(`${name}: selecting another client scopes edit and report actions`,()=>{
  mount(Page);fireEvent.click(screen.getByRole('button',{name:'Beta',pressed:false}));
  expect(screen.getByRole('button',{name:'Beta',pressed:true})).toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'Edit competitors'})).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Edit competitors'}));
  expect(screen.getByTestId('location')).toHaveTextContent('/clients/beta/competitive');
 });
 it(`${name}: saved client choice and search keep report navigation scoped`,()=>{
  mount(Page,'/?client=beta');
  expect(screen.getByRole('button',{name:'Beta',pressed:true})).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:' Alpha '}});
  expect(screen.queryByRole('button',{name:'Beta'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Run competitive report'}));
  expect(screen.getByTestId('location')).toHaveTextContent('/clients/alpha/competitive/run');
 });
 it(`${name}: unmatched search offers no action for the previously selected client`,()=>{
  mount(Page);fireEvent.change(screen.getByRole('searchbox'),{target:{value:'unknown'}});
  expect(screen.queryByRole('button',{name:'Edit competitors'})).not.toBeInTheDocument();
  expect(screen.getByText('No clients match your search.')).toBeInTheDocument();
 });
}
it('dashboard: archived directory cannot launch reports and permissions still apply',()=>{
 mount(AdminDashboard);fireEvent.click(screen.getByRole('button',{name:"Show archived"}));
 expect(screen.queryByRole('button',{name:'Run competitive report'})).not.toBeInTheDocument();
 cleanup();state.canRun=false;mount(AdminDashboard);
 expect(screen.queryByRole('button',{name:'Run competitive report'})).not.toBeInTheDocument();
});
