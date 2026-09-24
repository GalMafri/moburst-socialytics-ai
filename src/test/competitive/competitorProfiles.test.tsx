import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CompetitorReview from '@/pages/CompetitorReview';
const f=vi.hoisted(()=>({auto:true,calls:[] as any[],writes:[] as any[],toast:vi.fn(),detect:null as null|((id:string)=>Promise<any>)}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({canRunAnalysis:true})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:f.toast})}));
vi.mock('@/lib/telemetry',()=>({track:vi.fn()}));
vi.mock('@/components/layout/AppLayout',()=>({AppLayout:({children}:any)=><main>{children}</main>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 functions:{invoke:async(name:string,args:any)=>{f.calls.push({name,...args.body});if(name==='identify-competitors')return{data:{set_id:'set',competitors:[{id:'b'},{id:'c'}]},error:null};return f.detect?f.detect(args.body.competitor_id):{data:{results:[{status:'not_found',detected:[]}]},error:null};}},
 from(table:string){let write=false;const q:any={select(){return q},eq(){return q},in(){return q},neq(){return q},order(){return q},update(value:any){write=true;f.writes.push(value);return q},maybeSingle:async()=>({data:{id:'client',name:'Client'},error:null}),then(resolve:any,reject:any){let data:any=[];if(table==='competitor_sets')data=[{id:'set',client_id:'client',status:'draft',created_at:'2026-09-24'}];if(table==='competitors')data=['a','b','c'].map(id=>({id,set_id:'set',name:'Company '+id,website_url:'https://'+id+'.example',is_selected:false,source:'auto',profile_detection:f.auto?null:{status:'not_found',checked_at:new Date().toISOString()}}));if(table==='competitor_handles')data=[{id:'handle',competitor_id:'a',platform:'instagram',handle:'company_a',profile_url:'https://instagram.com/company_a',is_active:true,source:'rivaliq'}];return Promise.resolve({data:write?null:data,error:null}).then(resolve,reject)}};return q;}
}}));
let client:QueryClient;
beforeEach(()=>{f.auto=true;f.calls=[];f.writes=[];f.detect=null;f.toast.mockClear();client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});});
afterEach(()=>{cleanup();client.clear();});
function mount(){render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/clients/client/competitive']}><Routes><Route path="/clients/:id/competitive" element={<CompetitorReview/>}/></Routes></MemoryRouter></QueryClientProvider>);}
it('searches all missing profiles once, preserves tracked profiles, and shows failures truthfully',async()=>{
 f.detect=async id=>({data:{results:[{status:id==='b'?'failed':'not_found',detected:[],warnings:id==='b'?['Website returned HTTP 403.']:[]}]},error:null});
 mount();expect(screen.queryByRole('button',{name:'Find missing profiles'})).toBeNull();
 await screen.findByText('Profile lookup failed');expect(screen.getByText('Website returned HTTP 403.')).toBeInTheDocument();expect(screen.getByText('No profiles found on checked pages')).toBeInTheDocument();
 expect(f.calls.map(c=>c.competitor_id).sort()).toEqual(['b','c']);expect(screen.queryByText('No handles found')).toBeNull();expect(screen.getByRole('link',{name:/company_a/})).toBeInTheDocument();
});
it('starts profile detection automatically after identifying competitors and shows in-progress rows',async()=>{
 f.auto=false;let finish!:()=>void;const gate=new Promise<void>(resolve=>finish=resolve);f.detect=async()=>{await gate;return{data:{results:[{status:'not_found',detected:[]}]},error:null}};
 mount();fireEvent.click(await screen.findByRole('button',{name:'Re-identify (new draft)'}));
 await waitFor(()=>expect(f.calls.filter(c=>c.name==='detect-competitor-handles')).toHaveLength(2));
 expect(screen.getAllByText('Searching company pages…')).toHaveLength(2);expect(screen.queryByText('No handles found')).toBeNull();finish();await waitFor(()=>expect(screen.getByRole('button',{name:'Re-identify (new draft)'})).toBeEnabled());
});
it('does not remove a profile until the explicit confirmation',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Remove the instagram handle @company_a'}));
 expect(f.writes).toHaveLength(0);expect(screen.getByRole('alertdialog')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Remove profile'}));await waitFor(()=>expect(f.writes).toHaveLength(1));expect(f.writes[0]).toMatchObject({is_active:false,source:'rejected'});
});
it('keeps completed empty results across visits without repeating lookups or offering detection buttons',async()=>{
 f.auto=false;mount();await screen.findAllByText('No profiles found on checked pages');expect(f.calls).toHaveLength(0);expect(screen.queryByRole('button',{name:/Find missing|Re-detect|Look again/})).toBeNull();
});

it('shows an expired session once instead of blaming missing competitor profiles',async()=>{
 f.detect=async()=>({data:null,error:{context:new Response(JSON.stringify({error:'Invalid or expired session.'}),{status:401})}});
 mount();await screen.findByText('Your portal session has expired');expect(screen.queryByText('Profile lookup failed')).toBeNull();expect(screen.getByRole('link',{name:'Open Moburst portal'})).toHaveAttribute('href','https://tools.moburst.com/dashboard');expect(screen.getAllByText('Waiting for portal sign-in')).toHaveLength(2);
});
